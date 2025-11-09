import type { OpencodeClient } from "@opencode-ai/sdk";
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";

const DEFAULT_HOSTNAME = "127.0.0.1";

export type OpencodeInstance = {
  server: {
    url: string;
    port: number;
    close: () => void;
  };
  client: OpencodeClient;
};

type OpencodeServerConfig = {
  model?: string;
  directory?: string;
};

const activeInstances = new Map<string, OpencodeInstance>();

/**
 * Create a new OpenCode server instance
 *
 * Uses OS-assigned port allocation (port: 0) to guarantee no port conflicts.
 * The OS will automatically assign an available port from the ephemeral port range.
 */
export async function createOpencodeServer(
  config?: OpencodeServerConfig
): Promise<OpencodeInstance> {
  const instance = await createOpencode({
    hostname: DEFAULT_HOSTNAME,
    port: 0, // Let OS assign an available port
    config: {
      model: config?.model ?? "opencode/big-pickle",
    },
  });

  return {
    server: {
      url: instance.server.url,
      port: Number.parseInt(new URL(instance.server.url).port, 10),
      close: instance.server.close,
    },
    client: instance.client,
  };
}

/**
 * Get or create an OpenCode server instance for a specific key (e.g., construct ID)
 */
export async function getOrCreateInstance(
  key: string,
  config?: OpencodeServerConfig
): Promise<OpencodeInstance> {
  const existing = activeInstances.get(key);
  if (existing) {
    return existing;
  }

  const instance = await createOpencodeServer(config);
  activeInstances.set(key, instance);
  return instance;
}

/**
 * Get an existing OpenCode instance by key
 */
export function getInstance(key: string): OpencodeInstance | undefined {
  return activeInstances.get(key);
}

/**
 * Close and remove an OpenCode server instance
 */
export function closeInstance(key: string): void {
  const instance = activeInstances.get(key);
  if (instance) {
    try {
      instance.server.close();
    } catch {
      // Ignore cleanup errors
    }
    activeInstances.delete(key);
  }
}

/**
 * Create an OpenCode client for an existing server
 */
export function createClient(baseUrl: string): OpencodeClient {
  return createOpencodeClient({ baseUrl });
}

/**
 * Create a session and optionally send an initial message
 */
export async function createSessionWithMessage(params: {
  client: OpencodeClient;
  title?: string;
  message?: string;
  directory?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}): Promise<{ sessionId: string; title: string }> {
  const { client, title, message, directory, agent, model } = params;

  // Step 1: Create session
  const sessionResult = await client.session.create({
    body: { title },
  });

  if (sessionResult.error) {
    throw new Error("Failed to create session");
  }

  const session = sessionResult.data;

  // Step 2: Send initial message if provided (fire-and-forget)
  if (message) {
    const query = directory ? { directory } : undefined;
    const body: {
      parts: Array<{ type: "text"; text: string }>;
      agent?: string;
      model?: { providerID: string; modelID: string };
    } = {
      parts: [
        {
          type: "text" as const,
          text: message,
        },
      ],
    };

    if (agent) {
      body.agent = agent;
    }

    if (model) {
      body.model = model;
    }

    // Fire and forget - don't await
    client.session.prompt({
      path: { id: session.id },
      query,
      body,
    });
  }

  return {
    sessionId: session.id,
    title: session.title,
  };
}
