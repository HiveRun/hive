import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { Effect } from "effect";
import { Elysia, type Static, t } from "elysia";
import { glob } from "tinyglobby";
import { loadOpencodeConfig } from "../agents/opencode-config";
import { type HiveConfigError, HiveConfigService } from "../config/context";
import type { Template } from "../config/schema";
import { runServerEffect } from "../runtime";
import {
  TemplateListResponseSchema,
  TemplateResponseSchema,
} from "../schema/api";
import { resolveWorkspaceContextEffect } from "../workspaces/context";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

type TemplateListResponse = Static<typeof TemplateListResponseSchema>;
type TemplateResponse = Static<typeof TemplateResponseSchema>;

const POSIX_SEPARATOR = "/";
const INCLUDE_DIRECTORY_PREVIEW_LIMIT = 50;
const INCLUDE_PREVIEW_IGNORED_DIRECTORIES = [
  ".git",
  "node_modules",
  ".hive",
  ".turbo",
  "vendor",
];
const LEADING_DOT_SLASH_REGEX = /^\.\/+/;
const LEADING_GLOB_PREFIX_REGEX = /^\*\*\//;
const TRAILING_SEPARATOR_REGEX = /\/+$/;

const logTemplatesWarning = (message: string) => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  process.stderr.write(`[templates] ${message}\n`);
};

const toPosixPath = (value: string) => value.split(sep).join(POSIX_SEPARATOR);

const expandPattern = (pattern: string) =>
  pattern.includes("/") ? [pattern] : [pattern, `**/${pattern}`];

const buildIncludeIgnoreGlobs = (includePatterns: string[]) => {
  const allowedDirectories = new Set<string>();

  for (const pattern of includePatterns) {
    const sanitized = pattern
      .replace(LEADING_DOT_SLASH_REGEX, "")
      .replace(LEADING_GLOB_PREFIX_REGEX, "");
    const [firstSegment] = sanitized.split("/");

    if (!firstSegment || firstSegment === "**" || firstSegment.includes("*")) {
      continue;
    }

    allowedDirectories.add(firstSegment);
  }

  return INCLUDE_PREVIEW_IGNORED_DIRECTORIES.filter(
    (dir) => !allowedDirectories.has(dir)
  ).map((dir) => `**/${dir}/**`);
};

const normalizeMatchedPath = (match: string) => {
  const normalized = toPosixPath(match).replace(TRAILING_SEPARATOR_REGEX, "");
  return normalized.length === 0 ? "." : normalized;
};

const parentDirectory = (normalized: string) => {
  if (normalized === ".") {
    return ".";
  }
  const index = normalized.lastIndexOf(POSIX_SEPARATOR);
  return index === -1 ? "." : normalized.slice(0, index);
};

async function resolveIncludeDirectories(
  workspacePath: string,
  includePatterns: string[]
): Promise<string[]> {
  if (includePatterns.length === 0) {
    return [];
  }

  try {
    const expandedPatterns = includePatterns.flatMap(expandPattern);
    const ignoreGlobs = buildIncludeIgnoreGlobs(includePatterns);
    const matches = await glob(expandedPatterns, {
      cwd: workspacePath,
      absolute: false,
      ignore: ignoreGlobs,
      dot: true,
    });

    const directories = new Set<string>();
    for (const match of matches) {
      const normalized = normalizeMatchedPath(match);
      const absolutePath =
        normalized === "." ? workspacePath : join(workspacePath, normalized);

      let directory = normalized;
      try {
        const stats = await stat(absolutePath);
        if (!stats.isDirectory()) {
          directory = parentDirectory(normalized);
        }
      } catch {
        directory = parentDirectory(normalized);
      }

      directories.add(directory);
      if (directories.size >= INCLUDE_DIRECTORY_PREVIEW_LIMIT) {
        break;
      }
    }

    return Array.from(directories).sort();
  } catch (error) {
    logTemplatesWarning(
      `Failed to evaluate include patterns: ${formatUnknown(error)}`
    );
    return [];
  }
}

type TemplatesRouteError =
  | { _tag: "WorkspaceError"; message: string }
  | { _tag: "ConfigError"; message: string }
  | { _tag: "TemplateNotFound"; message: string }
  | { _tag: "OpencodeConfigError"; message: string };

const TEMPLATE_ERROR_STATUS: Record<TemplatesRouteError["_tag"], number> = {
  WorkspaceError: HTTP_STATUS.BAD_REQUEST,
  ConfigError: HTTP_STATUS.BAD_REQUEST,
  TemplateNotFound: HTTP_STATUS.NOT_FOUND,
  OpencodeConfigError: HTTP_STATUS.BAD_REQUEST,
};

function templateToResponse(
  id: string,
  template: Template,
  includeDirectories?: string[]
): TemplateResponse {
  const response: TemplateResponse = {
    id,
    label: template.label,
    type: template.type,
    configJson: template,
  } satisfies TemplateResponse;

  if (includeDirectories && includeDirectories.length > 0) {
    response.includeDirectories = includeDirectories;
  }

  return response;
}

const formatUnknown = (cause: unknown, fallback = "Unknown error") => {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return fallback;
};

const describeHiveConfigError = (error: HiveConfigError) => {
  const location = error.workspaceRoot
    ? ` for workspace '${error.workspaceRoot}'`
    : "";
  return `Failed to load workspace config${location}: ${formatUnknown(
    error.cause
  )}`;
};

const workspaceConfigEffect = (workspaceId?: string) =>
  Effect.gen(function* () {
    const context = yield* resolveWorkspaceContextEffect(workspaceId).pipe(
      Effect.mapError(
        (error) =>
          ({
            _tag: "WorkspaceError",
            message: error.message,
          }) satisfies TemplatesRouteError
      )
    );

    const hiveConfigService = yield* HiveConfigService;
    const config = yield* hiveConfigService.load(context.workspace.path).pipe(
      Effect.mapError(
        (error) =>
          ({
            _tag: "ConfigError",
            message: describeHiveConfigError(error),
          }) satisfies TemplatesRouteError
      )
    );

    return {
      config,
      workspacePath: context.workspace.path,
    };
  });

const loadOpencodeConfigEffect = (workspacePath: string) =>
  Effect.tryPromise({
    try: () => loadOpencodeConfig(workspacePath),
    catch: (cause) =>
      ({
        _tag: "OpencodeConfigError",
        message: `Failed to load OpenCode config for workspace '${workspacePath}': ${formatUnknown(
          cause
        )}`,
      }) satisfies TemplatesRouteError,
  });

const listTemplatesEffect = (workspaceId?: string) =>
  Effect.gen(function* () {
    const { config, workspacePath } = yield* workspaceConfigEffect(workspaceId);
    const templates = yield* Effect.forEach(
      Object.entries(config.templates),
      ([id, template]) => Effect.succeed(templateToResponse(id, template)),
      { concurrency: 4 }
    );
    const opencodeConfig = yield* loadOpencodeConfigEffect(workspacePath);
    return {
      templates,
      ...(config.defaults ? { defaults: config.defaults } : {}),
      ...(opencodeConfig.defaultModel
        ? { agentDefaults: opencodeConfig.defaultModel }
        : {}),
    } satisfies TemplateListResponse;
  });

const previewIncludeDirectoriesEffect = (
  workspacePath: string,
  templateId: string,
  template: Template
) => {
  const includePatterns = template.includePatterns ?? [];
  if (includePatterns.length === 0) {
    return Effect.succeed<string[]>([]);
  }

  return Effect.tryPromise({
    try: () => resolveIncludeDirectories(workspacePath, includePatterns),
    catch: (cause) => cause as Error,
  }).pipe(
    Effect.catchAll((cause) => {
      logTemplatesWarning(
        `Failed to preview include patterns for template '${templateId}': ${formatUnknown(
          cause
        )}`
      );
      return Effect.succeed<string[]>([]);
    })
  );
};

const templateDetailEffect = (templateId: string, workspaceId?: string) =>
  Effect.gen(function* () {
    const { config, workspacePath } = yield* workspaceConfigEffect(workspaceId);
    const template = config.templates[templateId];
    if (!template) {
      return yield* Effect.fail<TemplatesRouteError>({
        _tag: "TemplateNotFound",
        message: `Template '${templateId}' not found`,
      });
    }

    const includeDirectories = yield* previewIncludeDirectoriesEffect(
      workspacePath,
      templateId,
      template
    );

    return templateToResponse(templateId, template, includeDirectories);
  });

const matchTemplatesEffect = <T, R>(
  effect: Effect.Effect<T, TemplatesRouteError, R>,
  successStatus = HTTP_STATUS.OK
) =>
  Effect.match(effect, {
    onFailure: (error) => ({
      status: TEMPLATE_ERROR_STATUS[error._tag],
      body: { message: error.message },
    }),
    onSuccess: (value) => ({
      status: successStatus,
      body: value,
    }),
  });

const resolveWorkspaceId = (
  explicit: string | undefined,
  request: Request
): string | undefined => {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const headerValue = request.headers.get("x-workspace-id");
  return headerValue && headerValue.length > 0 ? headerValue : undefined;
};

export const templatesRoutes = new Elysia({ prefix: "/api/templates" })
  .get(
    "/",
    async ({ query, request, set }) => {
      const workspaceId = resolveWorkspaceId(query.workspaceId, request);
      const outcome = await runServerEffect(
        matchTemplatesEffect(listTemplatesEffect(workspaceId))
      );
      set.status = outcome.status;
      return outcome.body;
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: TemplateListResponseSchema,
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/:id",
    async ({ params, query, request, set }) => {
      const workspaceId = resolveWorkspaceId(query.workspaceId, request);
      const outcome = await runServerEffect(
        matchTemplatesEffect(templateDetailEffect(params.id, workspaceId))
      );
      set.status = outcome.status;
      return outcome.body;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: TemplateResponseSchema,
        400: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    }
  );
