import {
  createOpencodeClient,
  createOpencodeServer,
  type ServerOptions,
} from "@opencode-ai/sdk";
import type { LoadedOpencodeConfig } from "./opencode-config";

type OpencodeServerConfig = NonNullable<ServerOptions["config"]>;

type SharedOpencodeServerHandle = {
  server: Awaited<ReturnType<typeof createOpencodeServer>>;
  baseUrl: string;
  configSource: LoadedOpencodeConfig["source"];
  configDetails?: string;
};

type SharedOpencodeServerState = {
  handle: SharedOpencodeServerHandle | null;
  startPromise: Promise<SharedOpencodeServerHandle> | null;
};

const globalState = globalThis as typeof globalThis & {
  __hiveSharedOpencodeServerState?: SharedOpencodeServerState;
};
const sharedState = globalState.__hiveSharedOpencodeServerState ?? {
  handle: null,
  startPromise: null,
};
globalState.__hiveSharedOpencodeServerState = sharedState;

const DEFAULT_SHARED_SERVER_START_TIMEOUT_MS = 20_000;

function resolveSharedServerStartTimeoutMs(): number {
  const raw = process.env.HIVE_OPENCODE_START_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_SHARED_SERVER_START_TIMEOUT_MS;
}

async function createSharedServer(
  config: LoadedOpencodeConfig,
  port: number
): Promise<SharedOpencodeServerHandle> {
  const sourceLabel = config.source ?? "default";
  const detailSuffix = config.details ? ` (${config.details})` : "";
  const startupTimeoutMs = resolveSharedServerStartTimeoutMs();
  // biome-ignore lint/suspicious/noConsole: temporary until structured logging is wired up
  console.info(
    `[opencode] Starting shared server with config source '${sourceLabel}${detailSuffix}' (startup timeout ${startupTimeoutMs}ms)`
  );

  logProviderCatalog(config.config);

  process.env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "1";

  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port,
    timeout: startupTimeoutMs,
    config: config.config,
  });

  // biome-ignore lint/suspicious/noConsole: temporary until structured logging is wired up
  console.info(`[opencode] Shared server listening at ${server.url}`);

  const handle: SharedOpencodeServerHandle = {
    server,
    baseUrl: server.url,
    configSource: config.source,
    configDetails: config.details,
  };

  sharedState.handle = handle;
  return handle;
}

function logProviderCatalog(config: OpencodeServerConfig | undefined): void {
  if (!config || typeof config !== "object") {
    return;
  }

  const providerKeys = Object.keys(config.provider ?? {});
  if (providerKeys.length === 0) {
    return;
  }

  // biome-ignore lint/suspicious/noConsole: temporary until structured logging is wired up
  console.info(
    `[opencode] Providers available from shared config: ${providerKeys.join(", ")}`
  );
}

export async function startSharedOpencodeServer(
  config: LoadedOpencodeConfig,
  options: { port: number }
): Promise<void> {
  if (sharedState.handle) {
    return;
  }

  if (!sharedState.startPromise) {
    sharedState.startPromise = createSharedServer(config, options.port).catch(
      (error) => {
        sharedState.startPromise = null;
        throw error;
      }
    );
  }

  await sharedState.startPromise;
}

function getSharedHandle(): Promise<SharedOpencodeServerHandle> {
  if (sharedState.handle) {
    return Promise.resolve(sharedState.handle);
  }

  if (!sharedState.startPromise) {
    return Promise.reject(
      new Error("Shared OpenCode server has not been started")
    );
  }

  return sharedState.startPromise;
}

export async function acquireSharedOpencodeClient() {
  const handle = await getSharedHandle();
  return createOpencodeClient({ baseUrl: handle.baseUrl });
}

export function getSharedOpencodeServerBaseUrl(): string | null {
  return sharedState.handle?.baseUrl ?? null;
}

export async function stopSharedOpencodeServer(): Promise<void> {
  const handle =
    sharedState.handle ??
    (sharedState.startPromise
      ? await sharedState.startPromise.catch(() => null)
      : null);

  sharedState.handle = null;
  sharedState.startPromise = null;

  if (!handle) {
    return;
  }

  await handle.server.close();
}
