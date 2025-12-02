import { Effect } from "effect";
import { Elysia, type Static, t } from "elysia";
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

function templateToResponse(id: string, template: Template): TemplateResponse {
  return {
    id,
    label: template.label,
    type: template.type,
    configJson: template,
  } satisfies TemplateResponse;
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
    const templates = Object.entries(config.templates).map(([id, template]) =>
      templateToResponse(id, template)
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

const templateDetailEffect = (templateId: string, workspaceId?: string) =>
  Effect.gen(function* () {
    const { config } = yield* workspaceConfigEffect(workspaceId);
    const template = config.templates[templateId];
    if (!template) {
      return yield* Effect.fail<TemplatesRouteError>({
        _tag: "TemplateNotFound",
        message: `Template '${templateId}' not found`,
      });
    }
    return templateToResponse(templateId, template);
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
