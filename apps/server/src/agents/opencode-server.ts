import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createOpencodeClient,
  createOpencodeServer,
  type ServerOptions,
} from "@opencode-ai/sdk";
import { resolveHiveHome } from "../workspaces/registry";
import type { LoadedOpencodeConfig } from "./opencode-config";

type OpencodeServerConfig = NonNullable<ServerOptions["config"]>;

type SharedOpencodeServerHandle = {
  server: Awaited<ReturnType<typeof createOpencodeServer>>;
  baseUrl: string;
  configSource: LoadedOpencodeConfig["source"];
  configDetails?: string;
};

let sharedHandle: SharedOpencodeServerHandle | null = null;
let startPromise: Promise<SharedOpencodeServerHandle> | null = null;

const HIVE_OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG_DIR";
const HIVE_OPENCODE_CONFIG_DIRNAME = "opencode";

function resolveHiveOpencodeConfigDir() {
  return join(resolveHiveHome(), HIVE_OPENCODE_CONFIG_DIRNAME);
}

export const HIVE_OPENCODE_TOOL_SOURCE = `import { edenFetch } from "@elysiajs/eden";
import { tool } from "@opencode-ai/plugin";

const resolveHiveBaseUrl = () => {
  const explicit = process.env.HIVE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const port = process.env.PORT?.trim() || "3000";
  return "http://localhost:" + port;
};

type SubmitPlanResponse = {
  plan: {
    id: string;
    version: number;
  };
};

type HiveSubmitPlanArgs = {
  cellId: string;
  content: string;
};

export const hive_submit_plan = tool({
  description: "Submit a plan for a Hive cell (planning -> plan_review).",
  args: {
    cellId: tool.schema.string().min(1),
    content: tool.schema.string().min(1),
  },
  execute: async ({ cellId, content }: HiveSubmitPlanArgs) => {
    const baseUrl = resolveHiveBaseUrl();

    const api = edenFetch(baseUrl);
    const result = await api("/api/cells/:id/plan/submit", {
      method: "POST",
      params: { id: cellId },
      body: { content },
    });

    if (result.error) {
      const value = result.error.value;
      const message =
        value && typeof value === "object" && "message" in value
          ? String((value as { message?: unknown }).message)
          : "Failed to submit plan";
      throw new Error(message);
    }

    const response = result.data as SubmitPlanResponse;
    return "Submitted plan version " + response.plan.version + " for review.";
  },
});
`;

export async function ensureHiveOpencodeToolDirectory(): Promise<string> {
  const hiveConfigDir = resolveHiveOpencodeConfigDir();
  const toolDir = join(hiveConfigDir, "tool");
  await mkdir(toolDir, { recursive: true });

  await writeFile(join(toolDir, "hive.ts"), HIVE_OPENCODE_TOOL_SOURCE, "utf8");

  return hiveConfigDir;
}

async function withHiveOpencodeConfigDir<T>(
  handler: () => Promise<T>
): Promise<T> {
  const previous = process.env[HIVE_OPENCODE_CONFIG_ENV];
  const hiveConfigDir = await ensureHiveOpencodeToolDirectory();
  process.env[HIVE_OPENCODE_CONFIG_ENV] = hiveConfigDir;

  try {
    return await handler();
  } finally {
    if (previous === undefined) {
      delete process.env[HIVE_OPENCODE_CONFIG_ENV];
    } else {
      process.env[HIVE_OPENCODE_CONFIG_ENV] = previous;
    }
  }
}

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

  const server = await withHiveOpencodeConfigDir(() =>
    createOpencodeServer({
      hostname: "127.0.0.1",
      port: 0,
      config: config.config,
    })
  );

  // biome-ignore lint/suspicious/noConsole: temporary until structured logging is wired up
  console.info(`[opencode] Shared server listening at ${server.url}`);

  const handle: SharedOpencodeServerHandle = {
    server,
    baseUrl: server.url,
    configSource: config.source,
    configDetails: config.details,
  };

  sharedHandle = handle;
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
      throw error;
    });
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

  if (!handle) {
    return;
  }

  await handle.server.close();
}
