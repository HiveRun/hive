import { join } from "node:path";

import { Effect } from "effect";
import { Elysia, t } from "elysia";
import { ZodError } from "zod";

import { HiveConfigService } from "../config/context";
import { hiveConfigSchema } from "../config/schema";
import { HIVE_CONFIG_FILENAME, writeHiveConfigFile } from "../config/writer";
import { runServerEffect } from "../runtime";
import {
  HiveConfigSchema,
  HiveSettingsErrorSchema,
  HiveSettingsResponseSchema,
} from "../schema/api";
import { resolveWorkspaceContextEffect } from "../workspaces/context";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const cloneHiveConfigSchema = () =>
  JSON.parse(JSON.stringify(HiveConfigSchema));

const adaptSchemaForForm = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map((item) => adaptSchemaForForm(item));
  }

  if (schema && typeof schema === "object") {
    const entries = schema as Record<string, unknown>;

    if (
      entries.patternProperties &&
      typeof entries.patternProperties === "object"
    ) {
      const firstPattern = Object.values(
        entries.patternProperties as Record<string, unknown>
      )[0];
      if (firstPattern) {
        entries.additionalProperties = adaptSchemaForForm(firstPattern);
      }
      entries.patternProperties = undefined;
    }

    for (const key of Object.keys(entries)) {
      const value = entries[key];
      if (value && typeof value === "object") {
        entries[key] = adaptSchemaForForm(value);
      }
    }
  }

  return schema;
};

const createFormSchema = () => adaptSchemaForForm(cloneHiveConfigSchema());

type SettingsRouteError = {
  status: number;
  message: string;
  issues?: string[];
};

const formatUnknown = (cause: unknown, fallback: string) => {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return fallback;
};

const toError = (
  status: number,
  message: string,
  issues?: string[]
): SettingsRouteError => ({ status, message, ...(issues ? { issues } : {}) });

const matchSettingsEffect = <A, R>(
  effect: Effect.Effect<A, SettingsRouteError, R>
) =>
  Effect.match(effect, {
    onFailure: (error) => ({
      status: error.status,
      body: {
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
    }),
    onSuccess: (body) => ({ status: HTTP_STATUS.OK, body }),
  });

const formatIssues = (error: ZodError) =>
  error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });

const validateConfigEffect = (input: unknown) =>
  Effect.try({
    try: () => hiveConfigSchema.parse(input),
    catch: (cause) =>
      cause instanceof ZodError
        ? toError(
            HTTP_STATUS.UNPROCESSABLE_ENTITY,
            "Config validation failed",
            formatIssues(cause)
          )
        : toError(
            HTTP_STATUS.BAD_REQUEST,
            formatUnknown(cause, "Invalid configuration payload")
          ),
  });

const loadHiveSettingsEffect = (workspaceId?: string) =>
  resolveWorkspaceContextEffect(workspaceId).pipe(
    Effect.mapError((error) => toError(HTTP_STATUS.BAD_REQUEST, error.message)),
    Effect.flatMap((context) =>
      context.loadConfig().pipe(
        Effect.map((config) => ({
          workspaceId: context.workspace.id,
          workspacePath: context.workspace.path,
          configPath: join(context.workspace.path, HIVE_CONFIG_FILENAME),
          config,
          schema: createFormSchema(),
        })),
        Effect.mapError((error) =>
          toError(HTTP_STATUS.BAD_REQUEST, error.message)
        )
      )
    )
  );

const updateHiveSettingsEffect = (
  workspaceId: string | undefined,
  configInput: unknown
) =>
  Effect.gen(function* () {
    const context = yield* resolveWorkspaceContextEffect(workspaceId).pipe(
      Effect.mapError((error) =>
        toError(HTTP_STATUS.BAD_REQUEST, error.message)
      )
    );

    const validatedConfig = yield* validateConfigEffect(configInput);

    const configPath = yield* Effect.tryPromise({
      try: () => writeHiveConfigFile(context.workspace.path, validatedConfig),
      catch: (cause) =>
        toError(
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          formatUnknown(cause, "Failed to write hive.config.ts")
        ),
    });

    const hiveConfigService = yield* HiveConfigService;
    yield* hiveConfigService.clear(context.workspace.path);

    return {
      workspaceId: context.workspace.id,
      workspacePath: context.workspace.path,
      configPath,
      config: validatedConfig,
      schema: createFormSchema(),
    } satisfies SettingsResponse;
  });

type SettingsResponse = Effect.Effect.Success<
  ReturnType<typeof loadHiveSettingsEffect>
>;

export const settingsRoutes = new Elysia({ prefix: "/api/settings" })
  .get(
    "/hive",
    async ({ query, set }) => {
      const outcome = await runServerEffect(
        matchSettingsEffect(loadHiveSettingsEffect(query.workspaceId))
      );
      set.status = outcome.status;
      return outcome.body;
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: HiveSettingsResponseSchema,
        400: HiveSettingsErrorSchema,
      },
    }
  )
  .put(
    "/hive",
    async ({ query, body, set }) => {
      const outcome = await runServerEffect(
        matchSettingsEffect(updateHiveSettingsEffect(query.workspaceId, body))
      );
      set.status = outcome.status;
      return outcome.body;
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      body: HiveConfigSchema,
      response: {
        200: HiveSettingsResponseSchema,
        400: HiveSettingsErrorSchema,
        422: HiveSettingsErrorSchema,
        500: HiveSettingsErrorSchema,
      },
    }
  );
