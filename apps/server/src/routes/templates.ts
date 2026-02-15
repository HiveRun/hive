import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { Elysia, type Static, t } from "elysia";
import { glob } from "tinyglobby";
import { loadOpencodeConfig } from "../agents/opencode-config";
import { loadConfig } from "../config/loader";
import type { Template } from "../config/schema";
import {
  TemplateListResponseSchema,
  TemplateResponseSchema,
} from "../schema/api";
import {
  getWorkspaceRegistry,
  type WorkspaceRecord,
} from "../workspaces/registry";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

type TemplateListResponse = Static<typeof TemplateListResponseSchema>;
type TemplateResponse = Static<typeof TemplateResponseSchema>;
type AgentDefaults = TemplateListResponse["agentDefaults"];

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
const WORKSPACE_CONFIG_CACHE_TTL_MS = 60_000;
const OPENCODE_DEFAULTS_CACHE_TTL_MS = 60_000;

const workspaceConfigCache = new Map<
  string,
  {
    expiresAt: number;
    value: Awaited<ReturnType<typeof loadConfig>>;
  }
>();

const opencodeDefaultsCache = new Map<
  string,
  { expiresAt: number; value?: AgentDefaults }
>();

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

type TemplatesRouteResponse<T> = {
  status: number;
  body: T | { message: string };
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

const describeHiveConfigError = (workspacePath: string, cause: unknown) =>
  `Failed to load workspace config for workspace '${workspacePath}': ${formatUnknown(
    cause
  )}`;

const resolveWorkspace = async (
  workspaceId?: string
): Promise<WorkspaceRecord> => {
  const registry = await getWorkspaceRegistry();

  let workspace: WorkspaceRecord | undefined;
  if (workspaceId) {
    workspace = registry.workspaces.find((entry) => entry.id === workspaceId);
  } else if (registry.activeWorkspaceId) {
    workspace = registry.workspaces.find(
      (entry) => entry.id === registry.activeWorkspaceId
    );
  }

  if (!workspace) {
    throw {
      _tag: "WorkspaceError",
      message: workspaceId
        ? `Workspace '${workspaceId}' not found`
        : "No active workspace. Register and activate a workspace to continue.",
    } satisfies TemplatesRouteError;
  }

  return workspace;
};

const shouldUseRouteCaches = () => process.env.NODE_ENV !== "test";

const loadCachedWorkspaceConfig = async (workspacePath: string) => {
  if (!shouldUseRouteCaches()) {
    return await loadConfig(workspacePath);
  }

  const now = Date.now();
  const cached = workspaceConfigCache.get(workspacePath);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await loadConfig(workspacePath);
  workspaceConfigCache.set(workspacePath, {
    value,
    expiresAt: now + WORKSPACE_CONFIG_CACHE_TTL_MS,
  });
  return value;
};

const workspaceConfig = async (workspaceId?: string) => {
  let workspace: WorkspaceRecord;
  try {
    workspace = await resolveWorkspace(workspaceId);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "_tag" in (error as { _tag?: unknown })
    ) {
      throw error as TemplatesRouteError;
    }

    throw {
      _tag: "WorkspaceError",
      message: formatUnknown(error, "Failed to resolve workspace"),
    } satisfies TemplatesRouteError;
  }

  try {
    const config = await loadCachedWorkspaceConfig(workspace.path);
    return {
      config,
      workspacePath: workspace.path,
    };
  } catch (error) {
    throw {
      _tag: "ConfigError",
      message: describeHiveConfigError(workspace.path, error),
    } satisfies TemplatesRouteError;
  }
};

const loadOpencodeForWorkspace = async (workspacePath: string) => {
  try {
    return await loadOpencodeConfig(workspacePath);
  } catch (cause) {
    throw {
      _tag: "OpencodeConfigError",
      message: `Failed to load OpenCode config for workspace '${workspacePath}': ${formatUnknown(
        cause
      )}`,
    } satisfies TemplatesRouteError;
  }
};

const loadCachedOpencodeDefaults = async (
  workspacePath: string
): Promise<AgentDefaults | undefined> => {
  if (!shouldUseRouteCaches()) {
    const opencodeConfig = await loadOpencodeForWorkspace(workspacePath);
    return opencodeConfig.defaultModel;
  }

  const now = Date.now();
  const cached = opencodeDefaultsCache.get(workspacePath);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const opencodeConfig = await loadOpencodeForWorkspace(workspacePath);
  const value = opencodeConfig.defaultModel;
  opencodeDefaultsCache.set(workspacePath, {
    value,
    expiresAt: now + OPENCODE_DEFAULTS_CACHE_TTL_MS,
  });
  return value;
};

const listTemplates = async (
  workspaceId?: string
): Promise<TemplateListResponse> => {
  const { config, workspacePath } = await workspaceConfig(workspaceId);

  const templates = Object.entries(config.templates).map(([id, template]) =>
    templateToResponse(id, template)
  );

  const agentDefaults = await loadCachedOpencodeDefaults(workspacePath);

  return {
    templates,
    ...(config.defaults ? { defaults: config.defaults } : {}),
    ...(agentDefaults ? { agentDefaults } : {}),
  } satisfies TemplateListResponse;
};

const previewIncludeDirectories = async (
  workspacePath: string,
  templateId: string,
  template: Template
) => {
  const includePatterns = template.includePatterns ?? [];
  if (includePatterns.length === 0) {
    return [];
  }

  try {
    return await resolveIncludeDirectories(workspacePath, includePatterns);
  } catch (cause) {
    logTemplatesWarning(
      `Failed to preview include patterns for template '${templateId}': ${formatUnknown(
        cause
      )}`
    );
    return [];
  }
};

const loadTemplateDetail = async (
  templateId: string,
  workspaceId?: string
): Promise<TemplateResponse> => {
  const { config, workspacePath } = await workspaceConfig(workspaceId);
  const template = config.templates[templateId];
  if (!template) {
    throw {
      _tag: "TemplateNotFound",
      message: `Template '${templateId}' not found`,
    } satisfies TemplatesRouteError;
  }

  const includeDirectories = await previewIncludeDirectories(
    workspacePath,
    templateId,
    template
  );

  return templateToResponse(templateId, template, includeDirectories);
};

const matchTemplatesResult = async <T>(
  operation: () => Promise<T>,
  successStatus = HTTP_STATUS.OK
): Promise<TemplatesRouteResponse<T>> => {
  try {
    const value = await operation();
    return { status: successStatus, body: value };
  } catch (error) {
    const routeError =
      error &&
      typeof error === "object" &&
      "_tag" in (error as { _tag?: unknown }) &&
      "message" in (error as { message?: unknown })
        ? (error as TemplatesRouteError)
        : ({
            _tag: "ConfigError",
            message: formatUnknown(error, "Failed to load templates"),
          } satisfies TemplatesRouteError);

    return {
      status: TEMPLATE_ERROR_STATUS[routeError._tag],
      body: { message: routeError.message },
    };
  }
};

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
      const outcome = await matchTemplatesResult(() =>
        listTemplates(workspaceId)
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
      const outcome = await matchTemplatesResult(() =>
        loadTemplateDetail(params.id, workspaceId)
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
