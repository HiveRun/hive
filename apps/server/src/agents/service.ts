import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createOpencodeClient,
  createOpencodeServer,
  type Event,
  type Message,
  type Part,
  type Session,
} from "@opencode-ai/sdk";
import { eq } from "drizzle-orm";
import { getSyntheticConfig } from "../config/context";
import type { SyntheticConfig, Template } from "../config/schema";
import { db } from "../db";
import { type Construct, constructs } from "../schema/constructs";
import { publishAgentEvent } from "./events";
import type {
  AgentMessageRecord,
  AgentMessageState,
  AgentSessionRecord,
  AgentSessionStatus,
} from "./types";

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");

const runtimeRegistry = new Map<string, RuntimeHandle>();
const constructSessionMap = new Map<string, string>();
type DirectoryQuery = {
  directory?: string;
};

type RuntimeHandle = {
  session: Session;
  construct: Construct;
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

  const authEntries = await readProviderCredentials();
  if (!authEntries[providerId]) {
    throw new Error(
      `Missing OpenCode credentials for provider '${providerId}'. Run \`opencode auth login ${providerId}\` to continue.`
    );
  }
}

type TemplateAgentConfig = {
  providerId: string;
  modelId?: string;
};

function resolveTemplateAgentConfig(
  template: Template,
  config: SyntheticConfig
): TemplateAgentConfig {
  if (template.agent) {
    return {
      providerId: template.agent.providerId,
      modelId: template.agent.modelId ?? config.opencode.defaultModel,
    };
  }

  return {
    providerId: config.opencode.defaultProvider,
    modelId: config.opencode.defaultModel,
  };
}

export async function ensureAgentSession(
  constructId: string,
  options?: { force?: boolean }
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForConstruct(constructId, options);
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

export async function fetchAgentSessionForConstruct(
  constructId: string
): Promise<AgentSessionRecord | null> {
  try {
    const runtime = await ensureRuntimeForConstruct(constructId, {
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
  constructSessionMap.delete(runtime.construct.id);
}

export async function closeAgentSession(constructId: string): Promise<void> {
  const sessionId = constructSessionMap.get(constructId);
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

  const construct = await getConstructBySessionId(sessionId);
  if (!construct) {
    throw new Error("Agent session not found");
  }

  const runtime = await ensureRuntimeForConstruct(construct.id, {
    force: false,
  });
  return runtime;
}

async function ensureRuntimeForConstruct(
  constructId: string,
  options?: { force?: boolean }
): Promise<RuntimeHandle> {
  const currentSessionId = constructSessionMap.get(constructId);
  if (currentSessionId && !options?.force) {
    const activeRuntime = runtimeRegistry.get(currentSessionId);
    if (activeRuntime) {
      return activeRuntime;
    }
  }

  const construct = await getConstructById(constructId);
  if (!construct) {
    throw new Error("Construct not found");
  }

  const config = await getSyntheticConfig(
    construct.workspaceRootPath ?? construct.workspacePath
  );
  const template = config.templates[construct.templateId];
  if (!template) {
    throw new Error("Construct template configuration not found");
  }

  const agentConfig = resolveTemplateAgentConfig(template, config);

  await ensureProviderCredentials(agentConfig.providerId);

  const runtime = await startOpencodeRuntime({
    construct,
    providerId: agentConfig.providerId,
    modelId: agentConfig.modelId,
    force: options?.force ?? false,
  });

  constructSessionMap.set(construct.id, runtime.session.id);
  runtimeRegistry.set(runtime.session.id, runtime);

  return runtime;
}

type StartRuntimeArgs = {
  construct: Construct;
  providerId: string;
  modelId?: string;
  force: boolean;
};

async function startOpencodeRuntime({
  construct,
  providerId,
  modelId,
  force,
}: StartRuntimeArgs): Promise<RuntimeHandle> {
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
  });

  const client = createOpencodeClient({
    baseUrl: server.url,
  });

  const directoryQuery: DirectoryQuery = { directory: construct.workspacePath };
  const { session, created } = await resolveOpencodeSession({
    client,
    construct,
    directoryQuery,
    force,
  });

  if (created || construct.opencodeSessionId !== session.id) {
    await db
      .update(constructs)
      .set({ opencodeSessionId: session.id })
      .where(eq(constructs.id, construct.id));
    construct.opencodeSessionId = session.id;
  }

  const abortController = new AbortController();

  const runtime: RuntimeHandle = {
    session,
    construct,
    providerId,
    modelId,
    directoryQuery,
    client,
    server,
    abortController,
    status: "awaiting_input",
    async sendMessage(content) {
      setRuntimeStatus(runtime, "working");

      const response = await client.session.prompt({
        path: { id: session.id },
        query: directoryQuery,
        body: {
          parts: [{ type: "text", text: content }],
          model: modelId
            ? {
                providerID: providerId,
                modelID: modelId,
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
  construct: Construct;
  directoryQuery: DirectoryQuery;
  force: boolean;
};

async function resolveOpencodeSession({
  client,
  construct,
  directoryQuery,
  force,
}: ResolveSessionArgs): Promise<{ session: Session; created: boolean }> {
  if (!force && construct.opencodeSessionId) {
    const existing = await getRemoteSession(
      client,
      directoryQuery,
      construct.opencodeSessionId
    );
    if (existing) {
      return { session: existing, created: false };
    }
  }

  const created = await client.session.create({
    body: {
      title: construct.name,
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
    constructId: runtime.construct.id,
    templateId: runtime.construct.templateId,
    provider: runtime.providerId,
    status: runtime.status,
    workspacePath: runtime.construct.workspacePath,
    createdAt: new Date(runtime.session.time.created).toISOString(),
    updatedAt: new Date(runtime.session.time.updated).toISOString(),
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

async function getConstructById(id: string): Promise<Construct | null> {
  const [construct] = await db
    .select()
    .from(constructs)
    .where(eq(constructs.id, id))
    .limit(1);
  return construct ?? null;
}

async function getConstructBySessionId(
  sessionId: string
): Promise<Construct | null> {
  const [construct] = await db
    .select()
    .from(constructs)
    .where(eq(constructs.opencodeSessionId, sessionId))
    .limit(1);
  return construct ?? null;
}
