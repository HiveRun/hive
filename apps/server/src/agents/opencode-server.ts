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

// Global singleton to survive hot reloads (bun run --hot)
// Without this, every hot reload spawns a new orphaned OpenCode server process
declare global {
  // eslint-disable-next-line no-var
  var __HIVE_OPENCODE_HANDLE__: SharedOpencodeServerHandle | null;
  // eslint-disable-next-line no-var
  var __HIVE_OPENCODE_PROMISE__: Promise<SharedOpencodeServerHandle> | null;
}

let sharedHandle: SharedOpencodeServerHandle | null =
  globalThis.__HIVE_OPENCODE_HANDLE__ ?? null;
let startPromise: Promise<SharedOpencodeServerHandle> | null =
  globalThis.__HIVE_OPENCODE_PROMISE__ ?? null;

async function createSharedServer(
  config: LoadedOpencodeConfig
): Promise<SharedOpencodeServerHandle> {
  const sourceLabel = config.source ?? "default";
  const detailSuffix = config.details ? ` (${config.details})` : "";
  // biome-ignore lint/suspicious/noConsole: temporary until structured logging is wired up
  console.info(
    `[opencode] Starting shared server with config source '${sourceLabel}${detailSuffix}'`
  );

  logProviderCatalog(config.config);

  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
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

  sharedHandle = handle;
  globalThis.__HIVE_OPENCODE_HANDLE__ = handle;
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
  config: LoadedOpencodeConfig
): Promise<void> {
  if (sharedHandle) {
    return;
  }

  if (!startPromise) {
    startPromise = createSharedServer(config).catch((error) => {
      startPromise = null;
      globalThis.__HIVE_OPENCODE_PROMISE__ = null;
      throw error;
    });
    globalThis.__HIVE_OPENCODE_PROMISE__ = startPromise;
  }

  await startPromise;
}

function getSharedHandle(): Promise<SharedOpencodeServerHandle> {
  if (sharedHandle) {
    return Promise.resolve(sharedHandle);
  }

  if (!startPromise) {
    return Promise.reject(
      new Error("Shared OpenCode server has not been started")
    );
  }

  return startPromise;
}

export async function acquireSharedOpencodeClient() {
  const handle = await getSharedHandle();
  return createOpencodeClient({ baseUrl: handle.baseUrl });
}

export async function stopSharedOpencodeServer(): Promise<void> {
  const handle =
    sharedHandle ??
    (startPromise ? await startPromise.catch(() => null) : null);

  sharedHandle = null;
  startPromise = null;
  globalThis.__HIVE_OPENCODE_HANDLE__ = null;
  globalThis.__HIVE_OPENCODE_PROMISE__ = null;

  if (!handle) {
    return;
  }

  await handle.server.close();
}
