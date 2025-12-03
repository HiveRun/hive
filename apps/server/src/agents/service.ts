import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  createOpencodeClient,
  createOpencodeServer,
  type Event,
  type Message,
  type Part,
  type ServerOptions,
  type Session,
} from "@opencode-ai/sdk";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
  type HiveConfigError,
  HiveConfigService,
  loadHiveConfig,
} from "../config/context";
import type { HiveConfig, Template } from "../config/schema";
import { DatabaseService, db } from "../db";
import { type Cell, cells } from "../schema/cells";
import { publishAgentEvent } from "./events";
import { loadOpencodeConfig } from "./opencode-config";
import type {
  AgentMessageRecord,
  AgentMessageState,
  AgentSessionRecord,
  AgentSessionStatus,
} from "./types";

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");

const runtimeRegistry = new Map<string, RuntimeHandle>();
const cellSessionMap = new Map<string, string>();
type DirectoryQuery = {
  directory?: string;
};

type OpencodeServerConfig = NonNullable<ServerOptions["config"]>;

type RuntimeHandle = {
  session: Session;
  cell: Cell;
  providerId: string;
  modelId?: string;
  directoryQuery: DirectoryQuery;
  client: ReturnType<typeof createOpencodeClient>;
  server: { close(): void };
  abortController: AbortController;
  status: AgentSessionStatus;
  pendingInterrupt: boolean;
  sendMessage: (content: string) => Promise<void>;
  stop: () => Promise<void>;
};

export type ProviderModel = {
  id?: string;
  name?: string;
};

export type ProviderEntry = {
  id: string;
  name?: string;
  models?: Record<string, ProviderModel>;
};

type ProviderCatalogResponse = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof createOpencodeClient>["config"]["providers"]>
  >["data"]
>;

type ProviderAuthEntry = {
  token?: string;
  [key: string]: unknown;
};

type ProviderCredentialsStore = Record<string, ProviderAuthEntry>;

type AgentRuntimeDependencies = {
  db: typeof db;
  loadHiveConfig: (
    workspaceRoot?: string
  ) => Effect.Effect<HiveConfig, HiveConfigError> | Promise<HiveConfig>;
  loadOpencodeConfig: typeof loadOpencodeConfig;
  publishAgentEvent: typeof publishAgentEvent;
};

const agentRuntimeOverrides: Partial<AgentRuntimeDependencies> = {};

export const setAgentRuntimeDependencies = (
  overrides: Partial<AgentRuntimeDependencies>
) => {
  Object.assign(agentRuntimeOverrides, overrides);
};

export const resetAgentRuntimeDependencies = () => {
  for (const key of Object.keys(agentRuntimeOverrides)) {
    delete (agentRuntimeOverrides as Record<string, unknown>)[key];
  }
};

const getAgentRuntimeDependencies = (): AgentRuntimeDependencies => ({
  db: agentRuntimeOverrides.db ?? db,
  loadHiveConfig: agentRuntimeOverrides.loadHiveConfig ?? loadHiveConfig,
  loadOpencodeConfig:
    agentRuntimeOverrides.loadOpencodeConfig ?? loadOpencodeConfig,
  publishAgentEvent:
    agentRuntimeOverrides.publishAgentEvent ?? publishAgentEvent,
});

async function readProviderCredentials(): Promise<ProviderCredentialsStore> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    assertIsProviderCredentialStore(parsed, AUTH_PATH);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to read provider credentials from ${AUTH_PATH}: ${error instanceof Error ? error.message : error}`
    );
  }
}

function assertIsProviderCredentialStore(
  value: unknown,
  source: string
): asserts value is ProviderCredentialsStore {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Provider credentials at ${source} must be an object`);
  }

  for (const [providerId, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(
        `Credential entry for ${providerId} in ${source} must be an object`
      );
    }

    const maybeToken = (entry as { token?: unknown }).token;
    if (maybeToken !== undefined && typeof maybeToken !== "string") {
      throw new Error(
        `Credential entry for ${providerId} in ${source} has invalid "token"`
      );
    }
  }
}

const PROVIDERS_NOT_REQUIRING_AUTH = new Set(["zen", "opencode"]);

async function ensureProviderCredentials(providerId: string): Promise<void> {
  if (PROVIDERS_NOT_REQUIRING_AUTH.has(providerId)) {
    return;
  }

  const credentials = await readProviderCredentials();
  const providerAuth = credentials[providerId];
  if (!providerAuth) {
    throw new Error(
      `Missing authentication for ${providerId}. Run \\"opencode auth login ${providerId}\\".`
    );
  }
}

type TemplateAgentConfig = {
  providerId: string;
  modelId?: string;
};

function resolveTemplateAgentConfig(
  template: Template
): TemplateAgentConfig | undefined {
  if (!template.agent) {
    return;
  }

  const agentConfig: TemplateAgentConfig = {
    providerId: template.agent.providerId,
  };

  if (template.agent.modelId) {
    agentConfig.modelId = template.agent.modelId;
  }

  return agentConfig;
}

function resolveProviderId(
  options: { providerId?: string } | undefined,
  agentConfig: TemplateAgentConfig | undefined,
  defaultOpencodeModel: { providerId?: string } | undefined,
  configDefaultProvider: string
): string {
  if (options?.providerId) {
    return options.providerId;
  }

  if (agentConfig?.providerId) {
    return agentConfig.providerId;
  }

  return defaultOpencodeModel?.providerId ?? configDefaultProvider;
}

type ResolveModelArgs = {
  options?: { modelId?: string };
  agentConfig?: TemplateAgentConfig;
  configDefaultModel?: string;
  defaultOpencodeModel?: { providerId?: string; modelId?: string };
  resolvedProviderId: string;
};

function resolveModelId({
  options,
  agentConfig,
  configDefaultModel,
  defaultOpencodeModel,
  resolvedProviderId,
}: ResolveModelArgs): string | undefined {
  if (options?.modelId) {
    return options.modelId;
  }

  if (agentConfig?.modelId) {
    return agentConfig.modelId;
  }

  const opencodeMatchesProvider =
    defaultOpencodeModel?.modelId &&
    (!defaultOpencodeModel.providerId ||
      defaultOpencodeModel.providerId === resolvedProviderId)
      ? defaultOpencodeModel.modelId
      : undefined;

  if (opencodeMatchesProvider) {
    return opencodeMatchesProvider;
  }

  return configDefaultModel;
}

export async function ensureAgentSession(
  cellId: string,
  options?: { force?: boolean; modelId?: string; providerId?: string }
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForCell(cellId, options);
  return toSessionRecord(runtime);
}

export async function fetchAgentSession(
  sessionId: string
): Promise<AgentSessionRecord | null> {
  try {
    const runtime = await ensureRuntimeForSession(sessionId);
    return toSessionRecord(runtime);
  } catch {
    return null;
  }
}

export async function fetchAgentSessionForCell(
  cellId: string
): Promise<AgentSessionRecord | null> {
  try {
    const runtime = await ensureRuntimeForCell(cellId, {
      force: false,
    });
    return toSessionRecord(runtime);
  } catch {
    return null;
  }
}

export async function fetchAgentMessages(
  sessionId: string
): Promise<AgentMessageRecord[]> {
  const runtime = await ensureRuntimeForSession(sessionId);
  return loadRemoteMessages(runtime);
}

export async function updateAgentSessionModel(
  sessionId: string,
  model: { modelId: string; providerId?: string }
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForSession(sessionId);
  const nextProviderId = model.providerId ?? runtime.providerId;
  await ensureProviderCredentials(nextProviderId);
  runtime.providerId = nextProviderId;
  runtime.modelId = model.modelId;
  return toSessionRecord(runtime);
}

export async function sendAgentMessage(
  sessionId: string,
  content: string
): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  await runtime.sendMessage(content);
}

export async function interruptAgentSession(sessionId: string): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  runtime.pendingInterrupt = true;
  const result = await runtime.client.session.abort({
    path: { id: runtime.session.id },
    query: runtime.directoryQuery,
  });

  if (result.error) {
    runtime.pendingInterrupt = false;
    throw new Error(
      getRpcErrorMessage(result.error, "Failed to interrupt agent session")
    );
  }

  setRuntimeStatus(runtime, "awaiting_input");
}

export async function stopAgentSession(sessionId: string): Promise<void> {
  const runtime = runtimeRegistry.get(sessionId);
  if (!runtime) {
    return;
  }

  await runtime.stop();
  runtimeRegistry.delete(sessionId);
  cellSessionMap.delete(runtime.cell.id);
}

export async function closeAgentSession(cellId: string): Promise<void> {
  const sessionId = cellSessionMap.get(cellId);
  if (!sessionId) {
    return;
  }

  await stopAgentSession(sessionId);
}

export async function closeAllAgentSessions(): Promise<void> {
  const sessionIds = Array.from(runtimeRegistry.keys());

  for (const sessionId of sessionIds) {
    await stopAgentSession(sessionId);
  }
}

type AgentRuntimeError = {
  readonly _tag: "AgentRuntimeError";
  readonly cause: unknown;
};

const makeAgentRuntimeError = (cause: unknown): AgentRuntimeError => ({
  _tag: "AgentRuntimeError",
  cause,
});

const wrapAgentRuntime =
  <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) =>
  (...args: Args): Effect.Effect<Result, AgentRuntimeError> =>
    Effect.tryPromise({
      try: () => fn(...args),
      catch: (cause) => makeAgentRuntimeError(cause),
    });

export type AgentRuntimeService = {
  readonly ensureAgentSession: (
    cellId: string,
    options?: { force?: boolean; modelId?: string; providerId?: string }
  ) => Effect.Effect<AgentSessionRecord, AgentRuntimeError>;
  readonly fetchAgentSession: (
    sessionId: string
  ) => Effect.Effect<AgentSessionRecord | null, AgentRuntimeError>;
  readonly fetchAgentSessionForCell: (
    cellId: string
  ) => Effect.Effect<AgentSessionRecord | null, AgentRuntimeError>;
  readonly fetchAgentMessages: (
    sessionId: string
  ) => Effect.Effect<AgentMessageRecord[], AgentRuntimeError>;
  readonly updateAgentSessionModel: (
    sessionId: string,
    model: { modelId: string; providerId?: string }
  ) => Effect.Effect<AgentSessionRecord, AgentRuntimeError>;
  readonly sendAgentMessage: (
    sessionId: string,
    content: string
  ) => Effect.Effect<void, AgentRuntimeError>;
  readonly interruptAgentSession: (
    sessionId: string
  ) => Effect.Effect<void, AgentRuntimeError>;
  readonly stopAgentSession: (
    sessionId: string
  ) => Effect.Effect<void, AgentRuntimeError>;
  readonly closeAgentSession: (
    cellId: string
  ) => Effect.Effect<void, AgentRuntimeError>;
  readonly closeAllAgentSessions: Effect.Effect<void, AgentRuntimeError>;
  readonly respondAgentPermission: (
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject"
  ) => Effect.Effect<void, AgentRuntimeError>;
  readonly fetchProviderCatalogForWorkspace: (
    workspaceRootPath: string
  ) => Effect.Effect<ProviderCatalogResponse, AgentRuntimeError>;
};

export const AgentRuntimeServiceTag = Context.GenericTag<AgentRuntimeService>(
  "@hive/server/AgentRuntimeService"
);

const makeAgentRuntimeService = (): AgentRuntimeService => ({
  ensureAgentSession: (cellId, options) =>
    wrapAgentRuntime(ensureAgentSession)(cellId, options),
  fetchAgentSession: (sessionId) =>
    wrapAgentRuntime(fetchAgentSession)(sessionId),
  fetchAgentSessionForCell: (cellId) =>
    wrapAgentRuntime(fetchAgentSessionForCell)(cellId),
  fetchAgentMessages: (sessionId) =>
    wrapAgentRuntime(fetchAgentMessages)(sessionId),
  updateAgentSessionModel: (sessionId, model) =>
    wrapAgentRuntime(updateAgentSessionModel)(sessionId, model),
  sendAgentMessage: (sessionId, content) =>
    wrapAgentRuntime(sendAgentMessage)(sessionId, content),
  interruptAgentSession: (sessionId) =>
    wrapAgentRuntime(interruptAgentSession)(sessionId),
  stopAgentSession: (sessionId) =>
    wrapAgentRuntime(stopAgentSession)(sessionId),
  closeAgentSession: (cellId) => wrapAgentRuntime(closeAgentSession)(cellId),
  closeAllAgentSessions: wrapAgentRuntime(closeAllAgentSessions)(),
  respondAgentPermission: (sessionId, permissionId, response) =>
    wrapAgentRuntime(respondAgentPermission)(sessionId, permissionId, response),
  fetchProviderCatalogForWorkspace: (workspaceRootPath) =>
    wrapAgentRuntime(fetchProviderCatalogForWorkspace)(workspaceRootPath),
});

export const AgentRuntimeLayer = Layer.effect(
  AgentRuntimeServiceTag,
  Effect.gen(function* () {
    const { db: runtimeDb } = yield* DatabaseService;
    const hiveConfigService = yield* HiveConfigService;

    setAgentRuntimeDependencies({
      db: runtimeDb,
      loadHiveConfig: (workspaceRoot?: string) =>
        hiveConfigService.load(workspaceRoot),
    });
    return makeAgentRuntimeService();
  })
);

export async function respondAgentPermission(
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject"
): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  const result = await runtime.client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    query: runtime.directoryQuery,
    body: { response },
  });

  if (result.error) {
    throw new Error(
      getRpcErrorMessage(result.error, "Failed to respond to permission")
    );
  }
}

export async function ensureRuntimeForSession(
  sessionId: string
): Promise<RuntimeHandle> {
  const existing = runtimeRegistry.get(sessionId);
  if (existing) {
    return existing;
  }

  const cell = await getCellBySessionId(sessionId);
  if (!cell) {
    throw new Error("Agent session not found");
  }

  const runtime = await ensureRuntimeForCell(cell.id, {
    force: false,
  });
  return runtime;
}

async function ensureRuntimeForCell(
  cellId: string,
  options?: { force?: boolean; modelId?: string; providerId?: string }
): Promise<RuntimeHandle> {
  const currentSessionId = cellSessionMap.get(cellId);
  if (currentSessionId && !options?.force) {
    const activeRuntime = runtimeRegistry.get(currentSessionId);
    if (activeRuntime) {
      return activeRuntime;
    }
  }

  const cell = await getCellById(cellId);
  if (!cell) {
    throw new Error("Cell not found");
  }

  const workspaceRootPath = cell.workspaceRootPath || cell.workspacePath;
  const deps = getAgentRuntimeDependencies();

  const hiveConfigResult = deps.loadHiveConfig(workspaceRootPath);
  const hiveConfig =
    typeof (hiveConfigResult as unknown as { then?: unknown }).then ===
    "function"
      ? await (hiveConfigResult as Promise<HiveConfig>)
      : await Effect.runPromise(hiveConfigResult as Effect.Effect<HiveConfig>);
  const template = hiveConfig.templates[cell.templateId];
  if (!template) {
    throw new Error("Cell template configuration not found");
  }

  const agentConfig = resolveTemplateAgentConfig(template);
  const mergedConfig = await deps.loadOpencodeConfig(workspaceRootPath);
  const defaultOpencodeModel = mergedConfig.defaultModel;
  const configDefaultProvider = hiveConfig.opencode.defaultProvider;
  const configDefaultModel = hiveConfig.opencode.defaultModel;

  const requestedProviderId = resolveProviderId(
    options,
    agentConfig,
    defaultOpencodeModel,
    configDefaultProvider
  );

  const requestedModelId = resolveModelId({
    options,
    agentConfig,
    configDefaultModel,
    defaultOpencodeModel,
    resolvedProviderId: requestedProviderId,
  });

  await ensureProviderCredentials(requestedProviderId);

  const runtime = await startOpencodeRuntime({
    cell,
    providerId: requestedProviderId,
    modelId: requestedModelId,
    force: options?.force ?? false,
    opencodeConfig: mergedConfig.config,
    opencodeConfigSource: mergedConfig.source,
    opencodeConfigDetails: mergedConfig.details,
  });

  if (!options?.modelId) {
    const restoredModel = await resolveSessionModelPreference(runtime);
    if (restoredModel) {
      await ensureProviderCredentials(restoredModel.providerId);
      runtime.providerId = restoredModel.providerId;
      runtime.modelId = restoredModel.modelId;
    }
  } else if (options.providerId) {
    runtime.providerId = options.providerId;
    runtime.modelId = options.modelId;
  }

  cellSessionMap.set(cell.id, runtime.session.id);
  runtimeRegistry.set(runtime.session.id, runtime);

  return runtime;
}

export async function fetchProviderCatalogForWorkspace(
  workspaceRootPath: string
): Promise<ProviderCatalogResponse> {
  const { loadOpencodeConfig: loadConfig } = getAgentRuntimeDependencies();
  const mergedConfig = await loadConfig(workspaceRootPath);
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    config: mergedConfig.config,
  });

  try {
    const client = createOpencodeClient({
      baseUrl: server.url,
    });
    const response = await client.config.providers();

    if (response.error || !response.data) {
      throw new Error(
        getRpcErrorMessage(
          response.error,
          "Failed to fetch provider catalog from OpenCode"
        )
      );
    }

    return response.data;
  } finally {
    await server.close();
  }
}

type StartRuntimeArgs = {
  cell: Cell;
  providerId: string;
  modelId?: string;
  force: boolean;
  opencodeConfig?: OpencodeServerConfig;
  opencodeConfigSource?: "cli" | "workspace" | "default";
  opencodeConfigDetails?: string;
};

async function startOpencodeRuntime({
  cell,
  providerId,
  modelId,
  force,
  opencodeConfig,
  opencodeConfigSource,
  opencodeConfigDetails,
}: StartRuntimeArgs): Promise<RuntimeHandle> {
  const sourceLabel = opencodeConfigSource ?? "default";
  const detailSuffix = opencodeConfigDetails
    ? ` (${opencodeConfigDetails})`
    : "";
  // biome-ignore lint/suspicious/noConsole: temporary visibility until structured logging is wired up
  console.info(
    `[opencode] Resolved config source '${sourceLabel}${detailSuffix}' for cell ${cell.id}`
  );

  if (opencodeConfig && typeof opencodeConfig === "object") {
    const providerKeys = Object.keys(opencodeConfig.provider ?? {});
    if (providerKeys.length > 0) {
      // biome-ignore lint/suspicious/noConsole: temporary visibility until structured logging is wired up
      console.info(
        `[opencode] Providers available for cell ${cell.id}: ${providerKeys.join(", ")}`
      );
    }
  }

  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    config: opencodeConfig,
  });

  const client = createOpencodeClient({
    baseUrl: server.url,
  });

  const directoryQuery: DirectoryQuery = { directory: cell.workspacePath };
  const { session, created } = await resolveOpencodeSession({
    client,
    cell,
    directoryQuery,
    force,
  });

  if (created || cell.opencodeSessionId !== session.id) {
    const { db: runtimeDb } = getAgentRuntimeDependencies();
    await runtimeDb
      .update(cells)
      .set({ opencodeSessionId: session.id })
      .where(eq(cells.id, cell.id));
    cell.opencodeSessionId = session.id;
  }

  const abortController = new AbortController();

  const runtime: RuntimeHandle = {
    session,
    cell,
    providerId,
    modelId,
    directoryQuery,
    client,
    server,
    abortController,
    status: "awaiting_input",
    pendingInterrupt: false,
    async sendMessage(content) {
      setRuntimeStatus(runtime, "working");

      const activeModelId = runtime.modelId;
      const parts = [{ type: "text" as const, text: content }];
      const promptBody = activeModelId
        ? {
            parts,
            model: {
              providerID: runtime.providerId,
              modelID: activeModelId,
            },
          }
        : { parts };

      const response = await client.session.prompt({
        path: { id: session.id },
        query: directoryQuery,
        body: promptBody,
      });

      if (response.error) {
        if (runtime.pendingInterrupt && isMessageAbortedError(response.error)) {
          runtime.pendingInterrupt = false;
          setRuntimeStatus(runtime, "awaiting_input");
          return;
        }
        const errorMessage = getRpcErrorMessage(
          response.error,
          "Agent prompt failed"
        );
        setRuntimeStatus(runtime, "error", errorMessage);
        throw new Error(errorMessage);
      }

      runtime.pendingInterrupt = false;
    },
    async stop() {
      abortController.abort();
      await server.close();
      setRuntimeStatus(runtime, "completed");
    },
  };

  setRuntimeStatus(runtime, "awaiting_input");

  startEventStream({
    runtime,
    client,
    directoryQuery,
    abortController,
  });

  return runtime;
}

type ResolveSessionArgs = {
  client: ReturnType<typeof createOpencodeClient>;
  cell: Cell;
  directoryQuery: DirectoryQuery;
  force: boolean;
};

async function resolveOpencodeSession({
  client,
  cell,
  directoryQuery,
  force,
}: ResolveSessionArgs): Promise<{ session: Session; created: boolean }> {
  if (!force && cell.opencodeSessionId) {
    const existing = await getRemoteSession(
      client,
      directoryQuery,
      cell.opencodeSessionId
    );
    if (existing) {
      return { session: existing, created: false };
    }
  }

  const created = await client.session.create({
    body: {
      title: cell.name,
    },
    query: directoryQuery,
  });

  if (created.error || !created.data) {
    throw new Error(
      getRpcErrorMessage(created.error, "Failed to create OpenCode session")
    );
  }

  return { session: created.data, created: true };
}

async function getRemoteSession(
  client: ReturnType<typeof createOpencodeClient>,
  directoryQuery: DirectoryQuery,
  sessionId: string
): Promise<Session | null> {
  const response = await client.session.get({
    path: { id: sessionId },
    query: directoryQuery,
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

async function startEventStream({
  runtime,
  client,
  directoryQuery,
  abortController,
}: {
  runtime: RuntimeHandle;
  client: ReturnType<typeof createOpencodeClient>;
  directoryQuery: DirectoryQuery;
  abortController: AbortController;
}) {
  try {
    const events = await client.event.subscribe({
      query: directoryQuery,
      signal: abortController.signal,
    });
    const { publishAgentEvent: publish } = getAgentRuntimeDependencies();

    for await (const event of events.stream) {
      const eventSessionId = getEventSessionId(event);
      if (eventSessionId && eventSessionId !== runtime.session.id) {
        continue;
      }

      publish(runtime.session.id, event);
      updateRuntimeStatusFromEvent(runtime, event);
    }
  } catch {
    // Event stream closed
  }
}

async function resolveSessionModelPreference(
  runtime: RuntimeHandle
): Promise<{ providerId: string; modelId: string } | null> {
  try {
    const query = runtime.directoryQuery.directory
      ? { directory: runtime.directoryQuery.directory, limit: 100 }
      : { limit: 100 };
    const response = await runtime.client.session.messages({
      path: { id: runtime.session.id },
      query,
    });

    if (response.error || !response.data) {
      return null;
    }

    for (let index = response.data.length - 1; index >= 0; index -= 1) {
      const entry = response.data[index];
      if (!entry?.info) {
        continue;
      }
      const info: Message = entry.info;
      const modelSelection = extractMessageModelSelection(info);
      if (info.role === "user" && modelSelection) {
        return {
          providerId: modelSelection.providerId,
          modelId: modelSelection.modelId,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

type MessageModelSelection = {
  providerId: string;
  modelId: string;
};

function extractMessageModelSelection(
  info: Message
): MessageModelSelection | null {
  const candidate = (info as { model?: unknown }).model;
  if (
    candidate &&
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { providerID?: unknown }).providerID === "string" &&
    typeof (candidate as { modelID?: unknown }).modelID === "string"
  ) {
    const { providerID, modelID } = candidate as {
      providerID: string;
      modelID: string;
    };
    return { providerId: providerID, modelId: modelID };
  }
  return null;
}

function getMessageParentId(info: Message): string | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.parentID ?? null;
}

function getAssistantErrorDetails(
  info: Message
): AssistantMessage["error"] | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.error ?? null;
}

function getEventSessionId(event: Event): string | null {
  switch (event.type) {
    case "message.updated":
      return event.properties.info.sessionID;
    case "message.part.updated":
      return event.properties.part.sessionID;
    case "message.part.removed":
      return event.properties.sessionID ?? null;
    case "permission.updated":
      return event.properties.sessionID ?? null;
    case "permission.replied":
      return event.properties.sessionID ?? null;
    case "todo.updated":
      return event.properties.sessionID ?? null;
    case "session.compacted":
    case "session.diff":
    case "session.error":
    case "session.idle":
      return event.properties.sessionID ?? null;
    default:
      return null;
  }
}

function updateRuntimeStatusFromEvent(
  runtime: RuntimeHandle,
  event: Event
): void {
  if (
    event.type === "session.error" &&
    runtime.pendingInterrupt &&
    isSessionErrorAborted(event)
  ) {
    runtime.pendingInterrupt = false;
    setRuntimeStatus(runtime, "awaiting_input");
    return;
  }

  if (runtime.pendingInterrupt && event.type === "message.updated") {
    return;
  }

  const update = resolveRuntimeStatusFromEvent(event);
  if (!update) {
    return;
  }

  setRuntimeStatus(runtime, update.status, update.error);
}

export function resolveRuntimeStatusFromEvent(
  event: Event
): { status: AgentSessionStatus; error?: string } | null {
  if (event.type === "session.error") {
    const message = extractErrorMessage(event);
    return { status: "error", error: message };
  }

  if (event.type === "session.idle") {
    return { status: "awaiting_input" };
  }

  if (event.type !== "message.updated") {
    return null;
  }

  const info = event.properties.info;
  if (info.role === "assistant") {
    return { status: "working" };
  }

  return null;
}

async function loadRemoteMessages(
  runtime: RuntimeHandle
): Promise<AgentMessageRecord[]> {
  const response = await runtime.client.session.messages({
    path: { id: runtime.session.id },
    query: runtime.directoryQuery,
  });

  if (response.error || !response.data) {
    throw new Error(
      getRpcErrorMessage(response.error, "Failed to load agent messages")
    );
  }

  return response.data.map(({ info, parts }) => serializeMessage(info, parts));
}

function serializeMessage(info: Message, parts: Part[]): AgentMessageRecord {
  const contentText = extractTextFromParts(parts);
  const parentId = getMessageParentId(info);
  const errorDetails = getAssistantErrorDetails(info);
  const isAborted = isMessageAbortedError(errorDetails);
  const abortedErrorPayload = isAborted
    ? extractRpcErrorPayload(errorDetails)
    : null;

  return {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    content: contentText.length ? contentText : null,
    parts,
    state: determineMessageState(info),
    createdAt: new Date(info.time.created).toISOString(),
    parentId,
    errorName: isAborted ? (errorDetails?.name ?? null) : null,
    errorMessage: isAborted
      ? (abortedErrorPayload?.data?.message ??
        abortedErrorPayload?.message ??
        null)
      : null,
  };
}

function extractTextFromParts(parts: Part[] | undefined): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "reasoning") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function determineMessageState(message: Message): AgentMessageState {
  if (message.role === "assistant" && message.error) {
    return "error";
  }
  if (message.role === "assistant" && !message.time.completed) {
    return "streaming";
  }
  return "completed";
}

function toSessionRecord(runtime: RuntimeHandle): AgentSessionRecord {
  const modelFields =
    runtime.modelId === undefined
      ? {}
      : { modelId: runtime.modelId, modelProviderId: runtime.providerId };

  return {
    id: runtime.session.id,
    cellId: runtime.cell.id,
    templateId: runtime.cell.templateId,
    provider: runtime.providerId,
    status: runtime.status,
    workspacePath: runtime.cell.workspacePath,
    createdAt: new Date(runtime.session.time.created).toISOString(),
    updatedAt: new Date(runtime.session.time.updated).toISOString(),
    ...modelFields,
  };
}

function setRuntimeStatus(
  runtime: RuntimeHandle,
  status: AgentSessionStatus,
  error?: string
) {
  runtime.status = status;
  const statusEvent =
    error === undefined
      ? { type: "status" as const, status }
      : { type: "status" as const, status, error };
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  publish(runtime.session.id, statusEvent);
}

type RpcErrorPayload = {
  message?: string;
  data?: { message?: string };
};

function extractRpcErrorPayload(error: unknown): RpcErrorPayload | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as { message?: unknown; data?: unknown };
  const payload: RpcErrorPayload = {};

  if (typeof candidate.message === "string") {
    payload.message = candidate.message;
  }

  if (candidate.data && typeof candidate.data === "object") {
    const dataMessage = (candidate.data as { message?: unknown }).message;
    if (typeof dataMessage === "string") {
      payload.data = { message: dataMessage };
    }
  }

  return payload.message || payload.data ? payload : null;
}

function extractErrorMessage(event: Event): string {
  if (event.type !== "session.error") {
    return "Agent session error";
  }
  const rpcError = extractRpcErrorPayload(event.properties.error);
  if (rpcError?.data?.message) {
    return rpcError.data.message;
  }
  if (rpcError?.message) {
    return rpcError.message;
  }
  return "Agent session error";
}

function isSessionErrorAborted(event: Event): boolean {
  if (event.type !== "session.error") {
    return false;
  }
  return isMessageAbortedError(event.properties.error);
}

function isMessageAbortedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    name?: string;
    data?: { name?: string; message?: string };
    errors?: Array<{ name?: string }>;
  };
  if (candidate.name === "MessageAbortedError") {
    return true;
  }
  if (candidate.data?.name === "MessageAbortedError") {
    return true;
  }
  if (
    Array.isArray(candidate.errors) &&
    candidate.errors.some((item) => item?.name === "MessageAbortedError")
  ) {
    return true;
  }
  return false;
}

function getRpcErrorMessage(error: unknown, fallback: string): string {
  const rpcError = extractRpcErrorPayload(error);
  if (!rpcError) {
    return fallback;
  }
  if (rpcError.data?.message) {
    return rpcError.data.message;
  }
  if (rpcError.message) {
    return rpcError.message;
  }
  return fallback;
}

async function getCellById(id: string): Promise<Cell | null> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const [cell] = await runtimeDb
    .select()
    .from(cells)
    .where(eq(cells.id, id))
    .limit(1);
  return cell ?? null;
}

async function getCellBySessionId(sessionId: string): Promise<Cell | null> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const [cell] = await runtimeDb
    .select()
    .from(cells)
    .where(eq(cells.opencodeSessionId, sessionId))
    .limit(1);
  return cell ?? null;
}
