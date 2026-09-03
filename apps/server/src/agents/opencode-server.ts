import { setTimeout as delay } from "node:timers/promises";

import { OpenCode, type OpenCodeClient } from "@opencode-ai/client";
import {
  type Endpoint,
  type EnsureReason,
  Service,
} from "@opencode-ai/client/service";
import { OPENCODE_VERSION, resolveOpencodeBinary } from "./opencode-binary";

type SharedOpencodeServerHandle = {
  endpoint: Endpoint;
  client: OpenCodeClient;
};

type SharedOpencodeServerState = {
  handle: SharedOpencodeServerHandle | null;
  startPromise: Promise<SharedOpencodeServerHandle> | null;
  startOptions: SharedOpencodeServerStartOptions;
};

type SharedOpencodeServerStartOptions = {
  beforeReplace?: (client: OpenCodeClient) => Promise<void>;
};

const globalState = globalThis as typeof globalThis & {
  __hiveSharedOpencodeServerState?: SharedOpencodeServerState;
};
const sharedState = globalState.__hiveSharedOpencodeServerState ?? {
  handle: null,
  startPromise: null,
  startOptions: {},
};
sharedState.startOptions ??= {};
globalState.__hiveSharedOpencodeServerState = sharedState;

const DEFAULT_MIGRATION_TIMEOUT_MS = 600_000;
const MIGRATION_POLL_INTERVAL_MS = 250;
const SERVICE_REQUEST_TIMEOUT_MS = 10_000;

function resolveMigrationTimeoutMs(): number {
  const raw = process.env.HIVE_OPENCODE_MIGRATION_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MIGRATION_TIMEOUT_MS;
}

function createClient(endpoint: Endpoint): OpenCodeClient {
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  });
}

const serviceRequestOptions = (timeoutMs = SERVICE_REQUEST_TIMEOUT_MS) => ({
  signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
});

async function prepareServiceReplacement(
  options: SharedOpencodeServerStartOptions
): Promise<void> {
  const current = await Service.discover();
  if (!current) {
    return;
  }

  const client = createClient(current);
  const health = await client.health.get(serviceRequestOptions());
  if (health.version === OPENCODE_VERSION) {
    return;
  }

  await options.beforeReplace?.(client);
}

function describeMigrationProgress(
  status: Awaited<ReturnType<OpenCodeClient["migration"]["v1"]["status"]>>
): string {
  if (status.status !== "running") {
    return status.status;
  }
  const { label, numerator, denominator } = status.progress;
  if (numerator === undefined || denominator === undefined) {
    return label;
  }
  return `${label} (${numerator}/${denominator})`;
}

async function waitForV1Migration(client: OpenCodeClient): Promise<void> {
  const timeoutMs = resolveMigrationTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let latest = "required";

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    let status: Awaited<
      ReturnType<OpenCodeClient["migration"]["v1"]["status"]>
    >;
    const requestOptions = serviceRequestOptions(remainingMs);
    try {
      status = await client.migration.v1.status(requestOptions);
    } catch (error) {
      if (requestOptions.signal.aborted || Date.now() >= deadline) {
        break;
      }
      throw error;
    }
    latest = describeMigrationProgress(status);
    if (status.status === "completed") {
      return;
    }
    if (status.status === "error") {
      throw new Error(`OpenCode v1 migration failed: ${status.error}`);
    }
    await delay(MIGRATION_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for OpenCode v1 migration (${latest})`
  );
}

function logServiceStart(reason: EnsureReason, previousVersion?: string): void {
  const suffix = previousVersion ? ` (replacing ${previousVersion})` : "";
  // biome-ignore lint/suspicious/noConsole: service startup must remain visible before logger initialization
  console.info(
    `[opencode] Starting OpenCode ${OPENCODE_VERSION}: ${reason}${suffix}`
  );
}

async function createSharedServer(
  options: SharedOpencodeServerStartOptions
): Promise<SharedOpencodeServerHandle> {
  await prepareServiceReplacement(options);

  const endpoint = await Service.ensure({
    version: OPENCODE_VERSION,
    command: [resolveOpencodeBinary(), "serve", "--service"],
    env: {
      OPENCODE_CLIENT: "hive",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    onStart: logServiceStart,
  });
  const client = createClient(endpoint);
  const health = await client.health.get(serviceRequestOptions());
  if (health.version !== OPENCODE_VERSION) {
    throw new Error(
      `OpenCode service version mismatch: expected ${OPENCODE_VERSION}, received ${health.version}`
    );
  }

  await waitForV1Migration(client);

  const handle = { endpoint, client };
  sharedState.handle = handle;
  // biome-ignore lint/suspicious/noConsole: service startup must remain visible before logger initialization
  console.info(`[opencode] Connected to shared service at ${endpoint.url}`);
  return handle;
}

export async function startSharedOpencodeServer(
  options: SharedOpencodeServerStartOptions = {}
): Promise<void> {
  sharedState.startOptions = options;
  await ensureSharedHandle();
}

async function ensureSharedHandle(): Promise<SharedOpencodeServerHandle> {
  if (sharedState.handle) {
    try {
      const health = await sharedState.handle.client.health.get(
        serviceRequestOptions()
      );
      if (health.version === OPENCODE_VERSION) {
        return sharedState.handle;
      }
    } catch {
      // Re-discover the shared service after crashes or replacements.
    }
    sharedState.handle = null;
  }

  if (!sharedState.startPromise) {
    const startPromise = createSharedServer(sharedState.startOptions);
    sharedState.startPromise = startPromise;
    const clearStartPromise = () => {
      if (sharedState.startPromise === startPromise) {
        sharedState.startPromise = null;
      }
    };
    startPromise.then(clearStartPromise, clearStartPromise);
  }

  return sharedState.startPromise;
}

export async function acquireSharedOpencodeClient(): Promise<OpenCodeClient> {
  return (await ensureSharedHandle()).client;
}

export function getSharedOpencodeServerBaseUrl(): string | null {
  return sharedState.handle?.endpoint.url ?? null;
}

export function getSharedOpencodeServerConnection(): {
  url: string;
  password?: string;
} | null {
  const endpoint = sharedState.handle?.endpoint;
  if (!endpoint) {
    return null;
  }
  return {
    url: endpoint.url,
    ...(endpoint.auth?.password ? { password: endpoint.auth.password } : {}),
  };
}

export async function clearSharedOpencodeServerConnection(): Promise<void> {
  if (sharedState.startPromise) {
    await sharedState.startPromise.catch(() => null);
  }
  sharedState.handle = null;
  sharedState.startPromise = null;
  sharedState.startOptions = {};
}
