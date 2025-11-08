import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createOpencodeClient,
  createOpencodeServer,
  type Event,
  type Part,
} from "@opencode-ai/sdk";
import { loadConfig } from "../config/loader";
import type { SyntheticConfig, Template } from "../config/schema";
import type { constructs } from "../schema/constructs";
import { publishAgentEvent, subscribeAgentEvents } from "./events";
import {
  createAgentMessageRecord,
  createAgentSessionRecord,
  getAgentSessionByConstructId,
  getAgentSessionById,
  getConstructById,
  linkLatestUserMessageToOpencode,
  listAgentMessages,
  updateAgentSessionStatus,
  upsertAgentMessageRecord,
} from "./store";
import type {
  AgentMessageRecord,
  AgentMessageState,
  AgentSessionRecord,
  AgentStreamEvent,
} from "./types";

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");

const runtimeRegistry = new Map<string, RuntimeHandle>();
let cachedConfigPromise: Promise<SyntheticConfig> | null = null;

type DirectoryQuery = {
  directory?: string;
};

type RuntimeHandle = {
  sendMessage: (content: string) => Promise<AgentMessageRecord>;
  stop: () => Promise<void>;
};

function resolveWorkspaceRoot(): string {
  const currentDir = process.cwd();
  if (currentDir.includes("/apps/")) {
    const [root] = currentDir.split("/apps/");
    return root || currentDir;
  }
  return currentDir;
}

function getSyntheticConfig(): Promise<SyntheticConfig> {
  if (!cachedConfigPromise) {
    cachedConfigPromise = loadConfig(resolveWorkspaceRoot());
  }
  return cachedConfigPromise;
}

async function readProviderCredentials(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function ensureProviderCredentials(providerId: string): Promise<void> {
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
  config: SyntheticConfig,
  useMock: boolean | undefined
): TemplateAgentConfig {
  if (useMock) {
    return { providerId: "mock" };
  }

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
  options?: { force?: boolean; useMock?: boolean }
): Promise<AgentSessionRecord> {
  const wantsMock = options?.useMock === true;

  if (!options?.force) {
    const existing = await getAgentSessionByConstructId(constructId);
    if (existing && (!wantsMock || existing.provider === "mock")) {
      return existing;
    }
  }

  const construct = await getConstructById(constructId);
  if (!construct) {
    throw new Error("Construct not found");
  }

  const config = await getSyntheticConfig();
  const template = config.templates[construct.templateId];
  if (!template) {
    throw new Error("Construct template configuration not found");
  }

  const agentConfig = resolveTemplateAgentConfig(
    template,
    config,
    options?.useMock
  );

  if (agentConfig.providerId !== "mock") {
    await ensureProviderCredentials(agentConfig.providerId);
  }

  if (agentConfig.providerId === "mock") {
    return startMockSession({
      construct,
      providerId: agentConfig.providerId,
    });
  }

  return startOpencodeSession({
    construct,
    template,
    providerId: agentConfig.providerId,
    modelId: agentConfig.modelId,
  });
}

export function fetchAgentSession(
  sessionId: string
): Promise<AgentSessionRecord | null> {
  return getAgentSessionById(sessionId);
}

export function fetchAgentSessionForConstruct(
  constructId: string
): Promise<AgentSessionRecord | null> {
  return getAgentSessionByConstructId(constructId);
}

export function fetchAgentMessages(sessionId: string) {
  return listAgentMessages(sessionId);
}

export function sendAgentMessage(
  sessionId: string,
  content: string
): Promise<AgentMessageRecord> {
  const runtime = runtimeRegistry.get(sessionId);
  if (!runtime) {
    throw new Error(
      "Agent session is not active. Restart the session to continue."
    );
  }

  return runtime.sendMessage(content);
}

export async function stopAgentSession(sessionId: string): Promise<void> {
  const runtime = runtimeRegistry.get(sessionId);
  if (runtime) {
    await runtime.stop();
    runtimeRegistry.delete(sessionId);
  }

  await updateAgentSessionStatus(sessionId, "completed", { completed: true });
  publishAgentEvent(sessionId, { type: "status", status: "completed" });
}

export function createAgentEventStream(
  sessionId: string,
  signal: AbortSignal
): Response {
  let unsubscribe: (() => void) | null = null;
  let abortHandler: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: AgentStreamEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      unsubscribe = subscribeAgentEvents(sessionId, send);
      abortHandler = () => {
        unsubscribe?.();
        controller.close();
      };

      signal.addEventListener("abort", abortHandler, { once: true });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (abortHandler) {
        signal.removeEventListener("abort", abortHandler);
        abortHandler = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function startMockSession({
  construct,
  providerId,
}: {
  construct: typeof constructs.$inferSelect;
  providerId: string;
}): Promise<AgentSessionRecord> {
  const session = await createAgentSessionRecord({
    constructId: construct.id,
    templateId: construct.templateId,
    workspacePath: construct.workspacePath,
    provider: providerId,
    status: "idle",
    opencodeSessionId: `mock-${randomUUID()}`,
  });

  const runtime: RuntimeHandle = {
    async sendMessage(content) {
      const userMessage = await createAgentMessageRecord({
        sessionId: session.id,
        role: "user",
        content,
        state: "completed",
      });
      publishAgentEvent(session.id, { type: "message", message: userMessage });

      await updateAgentSessionStatus(session.id, "working");
      publishAgentEvent(session.id, { type: "status", status: "working" });

      const assistantContent = `Mock response for construct ${construct.name}:\n${content}`;
      const assistantMessage = await createAgentMessageRecord({
        sessionId: session.id,
        role: "assistant",
        content: assistantContent,
        state: "completed",
      });

      await updateAgentSessionStatus(session.id, "awaiting_input");
      publishAgentEvent(session.id, {
        type: "message",
        message: assistantMessage,
      });
      publishAgentEvent(session.id, {
        type: "status",
        status: "awaiting_input",
      });

      return assistantMessage;
    },
    async stop() {
      // no-op
    },
  };

  runtimeRegistry.set(session.id, runtime);
  return session;
}

type OpenCodeSessionArgs = {
  construct: typeof constructs.$inferSelect;
  template: Template;
  providerId: string;
  modelId?: string;
};

async function startOpencodeSession({
  construct,
  template,
  providerId,
  modelId,
}: OpenCodeSessionArgs): Promise<AgentSessionRecord> {
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
  });

  const client = createOpencodeClient({
    baseUrl: server.url,
  });

  const directoryQuery: DirectoryQuery = { directory: construct.workspacePath };

  const sessionResult = await client.session.create({
    body: {
      title: construct.name,
    },
    query: directoryQuery,
  });

  if (sessionResult.error || !sessionResult.data) {
    await server.close();
    throw new Error(
      getRpcErrorMessage(
        sessionResult.error,
        "Failed to create OpenCode session"
      )
    );
  }

  const remoteSessionId = sessionResult.data.id;
  const session = await createAgentSessionRecord({
    constructId: construct.id,
    templateId: template.id,
    workspacePath: construct.workspacePath,
    provider: providerId,
    status: "starting",
    opencodeSessionId: remoteSessionId,
  });

  const runtime = createOpencodeRuntime({
    session,
    server,
    client,
    directoryQuery,
    providerId,
    modelId,
  });

  runtimeRegistry.set(session.id, runtime);

  await updateAgentSessionStatus(session.id, "idle");
  publishAgentEvent(session.id, { type: "status", status: "idle" });

  return session;
}

type CreateRuntimeArgs = {
  session: AgentSessionRecord;
  server: { close: () => void };
  client: ReturnType<typeof createOpencodeClient>;
  directoryQuery: DirectoryQuery;
  providerId: string;
  modelId?: string;
};

function createOpencodeRuntime({
  session,
  server,
  client,
  directoryQuery,
  providerId,
  modelId,
}: CreateRuntimeArgs): RuntimeHandle {
  const abortController = new AbortController();

  startEventStream({
    session,
    client,
    directoryQuery,
    abortController,
  });

  return {
    async sendMessage(content) {
      const userMessage = await createAgentMessageRecord({
        sessionId: session.id,
        role: "user",
        content,
        state: "completed",
      });
      publishAgentEvent(session.id, { type: "message", message: userMessage });

      await updateAgentSessionStatus(session.id, "working");
      publishAgentEvent(session.id, { type: "status", status: "working" });

      const response = await client.session.prompt({
        path: { id: session.opencodeSessionId },
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

      if (response.error || !response.data) {
        const errorMessage = getRpcErrorMessage(
          response.error,
          "Agent prompt failed"
        );
        await updateAgentSessionStatus(session.id, "error", {
          error: errorMessage,
        });
        publishAgentEvent(session.id, {
          type: "status",
          status: "error",
          error: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const partsJson = JSON.stringify(response.data.parts ?? []);
      const assistantMessage = await upsertAgentMessageRecord({
        sessionId: session.id,
        opencodeMessageId: response.data.info.id,
        role: "assistant",
        content: extractTextFromParts(response.data.parts),
        parts: partsJson,
        state: response.data.info.time?.completed ? "completed" : "streaming",
      });

      publishAgentEvent(session.id, {
        type: "message",
        message: assistantMessage,
      });

      if (assistantMessage.state === "completed") {
        await updateAgentSessionStatus(session.id, "awaiting_input");
        publishAgentEvent(session.id, {
          type: "status",
          status: "awaiting_input",
        });
      }

      return assistantMessage;
    },
    async stop() {
      abortController.abort();
      await server.close();
    },
  };
}

type EventStreamArgs = {
  session: AgentSessionRecord;
  client: ReturnType<typeof createOpencodeClient>;
  directoryQuery: DirectoryQuery;
  abortController: AbortController;
};

async function startEventStream({
  session,
  client,
  directoryQuery,
  abortController,
}: EventStreamArgs) {
  try {
    const events = await client.event.subscribe({
      query: directoryQuery,
      signal: abortController.signal,
    });

    for await (const event of events.stream) {
      await handleOpencodeEvent({
        event,
        session,
        client,
        directoryQuery,
      });
    }
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: fallback logging until structured logger is wired up.
    console.error("Agent event stream exited", error);
  }
}

type HandleEventArgs = {
  event: Event;
  session: AgentSessionRecord;
  client: ReturnType<typeof createOpencodeClient>;
  directoryQuery: DirectoryQuery;
};

async function handleOpencodeEvent({
  event,
  session,
  client,
  directoryQuery,
}: HandleEventArgs) {
  if (event.type === "message.updated") {
    await syncRemoteMessage({
      session,
      client,
      directoryQuery,
      messageId: event.properties.info.id,
    });
  } else if (event.type === "message.part.updated") {
    await syncRemoteMessage({
      session,
      client,
      directoryQuery,
      messageId: event.properties.part.messageID,
    });
  } else if (event.type === "session.error") {
    const message = extractErrorMessage(event);
    await updateAgentSessionStatus(session.id, "error", { error: message });
    publishAgentEvent(session.id, {
      type: "status",
      status: "error",
      error: message,
    });
  }
}

type SyncArgs = {
  session: AgentSessionRecord;
  client: ReturnType<typeof createOpencodeClient>;
  directoryQuery: DirectoryQuery;
  messageId: string;
};

async function syncRemoteMessage({
  session,
  client,
  directoryQuery,
  messageId,
}: SyncArgs) {
  const response = await client.session.message({
    path: { id: session.opencodeSessionId, messageID: messageId },
    query: directoryQuery,
  });

  if (response.error || !response.data) {
    return;
  }

  const parts = response.data.parts ?? [];
  const content = extractTextFromParts(parts);
  const serializedParts = JSON.stringify(parts);
  const state = determineMessageState(response.data.info as MessageInfo);

  if (response.data.info.role === "user") {
    await linkLatestUserMessageToOpencode(session.id, response.data.info.id, {
      content,
      parts: serializedParts,
    });
    return;
  }

  const updatedMessage = await upsertAgentMessageRecord({
    sessionId: session.id,
    opencodeMessageId: response.data.info.id,
    role: "assistant",
    content,
    parts: serializedParts,
    state,
  });

  publishAgentEvent(session.id, { type: "message", message: updatedMessage });

  if (state === "completed") {
    await updateAgentSessionStatus(session.id, "awaiting_input");
    publishAgentEvent(session.id, {
      type: "status",
      status: "awaiting_input",
    });
  }
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

type MessageInfo = {
  time?: {
    completed?: number;
    created?: number;
  };
  error?: unknown;
};

function determineMessageState(message: MessageInfo): AgentMessageState {
  if (message?.error) {
    return "error";
  }
  if (message?.time?.completed) {
    return "completed";
  }
  return "streaming";
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
