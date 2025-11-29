import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createOpencodeClient,
  createOpencodeServer,
  type Event,
  type Message,
  type Part,
  type ServerOptions,
  type Session,
} from "@opencode-ai/sdk";
import { eq } from "drizzle-orm";
import { getHiveConfig } from "../config/context";
import type { Template } from "../config/schema";
import { db } from "../db";
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

export type ProviderCatalogResponse = {
  providers?: ProviderEntry[];
  default?: Record<string, string>;
};

async function readProviderCredentials(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
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

  return {
    providerId: template.agent.providerId,
    modelId: template.agent.modelId,
  };
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

  const hiveConfig = await getHiveConfig(workspaceRootPath);
  const template = hiveConfig.templates[cell.templateId];
  if (!template) {
    throw new Error("Cell template configuration not found");
  }

  const agentConfig = resolveTemplateAgentConfig(template);
  const mergedConfig = await loadOpencodeConfig(workspaceRootPath);
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
    opencodeConfig: mergedConfig.config as OpencodeServerConfig,
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
  const mergedConfig = await loadOpencodeConfig(workspaceRootPath);
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    config: mergedConfig.config as OpencodeServerConfig,
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

    return response.data as ProviderCatalogResponse;
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
    const providerKeys = Object.keys(
      (opencodeConfig as { provider?: Record<string, unknown> }).provider ?? {}
    );
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
    await db
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
    async sendMessage(content) {
      setRuntimeStatus(runtime, "working");

      const activeModelId = runtime.modelId;
      const response = await client.session.prompt({
        path: { id: session.id },
        query: directoryQuery,
        body: {
          parts: [{ type: "text", text: content }],
          model: activeModelId
            ? {
                providerID: runtime.providerId,
                modelID: activeModelId,
              }
            : undefined,
        },
      });

      if (response.error) {
        const errorMessage = getRpcErrorMessage(
          response.error,
          "Agent prompt failed"
        );
        setRuntimeStatus(runtime, "error", errorMessage);
        throw new Error(errorMessage);
      }
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

    for await (const event of events.stream) {
      const eventSessionId = getEventSessionId(event);
      if (eventSessionId && eventSessionId !== runtime.session.id) {
        continue;
      }

      publishAgentEvent(runtime.session.id, event);
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
      const info = entry.info as Message & {
        model?: { providerID: string; modelID: string };
      };
      if (info.role === "user" && info.model) {
        return {
          providerId: info.model.providerID,
          modelId: info.model.modelID,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
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
  return {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    content: contentText.length ? contentText : null,
    parts,
    state: determineMessageState(info),
    createdAt: new Date(info.time.created).toISOString(),
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
  return {
    id: runtime.session.id,
    cellId: runtime.cell.id,
    templateId: runtime.cell.templateId,
    provider: runtime.providerId,
    status: runtime.status,
    workspacePath: runtime.cell.workspacePath,
    createdAt: new Date(runtime.session.time.created).toISOString(),
    updatedAt: new Date(runtime.session.time.updated).toISOString(),
    modelId: runtime.modelId,
    modelProviderId: runtime.modelId ? runtime.providerId : undefined,
  };
}

function setRuntimeStatus(
  runtime: RuntimeHandle,
  status: AgentSessionStatus,
  error?: string
) {
  runtime.status = status;
  publishAgentEvent(runtime.session.id, { type: "status", status, error });
}

function extractErrorMessage(event: Event): string {
  if (event.type !== "session.error") {
    return "Agent session error";
  }
  const err = event.properties.error as
    | { data?: { message?: string } }
    | undefined;
  if (err?.data?.message) {
    return err.data.message;
  }
  return "Agent session error";
}

function getRpcErrorMessage(error: unknown, fallback: string): string {
  if (!error) {
    return fallback;
  }
  if (typeof error === "object" && error !== null) {
    const rpcError = error as { data?: { message?: string }; message?: string };
    if (typeof rpcError.data?.message === "string") {
      return rpcError.data.message;
    }
    if (typeof rpcError.message === "string") {
      return rpcError.message;
    }
  }
  return fallback;
}

async function getCellById(id: string): Promise<Cell | null> {
  const [cell] = await db.select().from(cells).where(eq(cells.id, id)).limit(1);
  return cell ?? null;
}

async function getCellBySessionId(sessionId: string): Promise<Cell | null> {
  const [cell] = await db
    .select()
    .from(cells)
    .where(eq(cells.opencodeSessionId, sessionId))
    .limit(1);
  return cell ?? null;
}
