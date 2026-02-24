import "dotenv/config";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "@bogeychan/elysia-logger";

import { cors } from "@elysiajs/cors";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Elysia } from "elysia";
import { loadOpencodeConfig } from "./agents/opencode-config";
import {
  startSharedOpencodeServer,
  stopSharedOpencodeServer,
} from "./agents/opencode-server";
import {
  closeAllAgentSessions,
  markAgentSessionsForResume,
  resumeAgentSessionsOnStartup,
} from "./agents/service";
import { resolveWorkspaceRoot } from "./config/context";
import { DatabaseService } from "./db";
import { agentsRoutes } from "./routes/agents";
import { cellOpencodeRoutes } from "./routes/cell-opencode";
import { cellsRoutes, resumeSpawningCells } from "./routes/cells";
import { templatesRoutes } from "./routes/templates";
import { workspacesRoutes } from "./routes/workspaces";
import { cells } from "./schema/cells";
import { chatTerminalService } from "./services/chat-terminal";
import { ServiceSupervisorService } from "./services/supervisor";
import { cellTerminalService } from "./services/terminal";
import {
  ensureWorkspaceRegistered,
  resolveHiveHome,
} from "./workspaces/registry";

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_HOSTNAME = "localhost";
const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const HOSTNAME = process.env.HOST ?? process.env.HOSTNAME ?? DEFAULT_HOSTNAME;

const SILENCE_TERMINAL_TRAFFIC_LOGS =
  process.env.HIVE_LOG_TERMINAL_TRAFFIC !== "1";
const SILENCE_POLLING_TRAFFIC_LOGS =
  process.env.HIVE_LOG_POLLING_TRAFFIC !== "1";
const SILENCE_OPTIONS_REQUEST_LOGS =
  process.env.HIVE_LOG_OPTIONS_REQUESTS !== "1";

const TERMINAL_TRAFFIC_PATH_PATTERNS = [
  /^\/api\/cells\/[^/]+\/chat\/terminal\/(stream|input|resize)$/,
  /^\/api\/cells\/[^/]+\/terminal\/(stream|input|resize)$/,
  /^\/api\/cells\/[^/]+\/setup\/terminal\/(input|resize)$/,
  /^\/api\/cells\/[^/]+\/services\/[^/]+\/terminal\/(input|resize)$/,
  /^\/api\/cells\/[^/]+\/opencode\/proxy(?:\/.*)?$/,
];

const POLLING_TRAFFIC_PATH_PATTERNS = [
  /^\/api\/agents\/sessions\/byCell\/[^/]+$/,
  /^\/api\/agents\/sessions\/[^/]+\/events$/,
  /^\/api\/cells\/workspace\/[^/]+\/stream$/,
];

function readPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function shouldIgnoreAutoRequestLog(ctx: {
  request: Request;
  isError?: boolean;
}): boolean {
  if (ctx.isError) {
    return false;
  }

  if (SILENCE_OPTIONS_REQUEST_LOGS && ctx.request.method === "OPTIONS") {
    return true;
  }

  const pathname = readPathname(ctx.request.url);
  if (
    SILENCE_TERMINAL_TRAFFIC_LOGS &&
    TERMINAL_TRAFFIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
  ) {
    return true;
  }

  if (
    SILENCE_POLLING_TRAFFIC_LOGS &&
    POLLING_TRAFFIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
  ) {
    return true;
  }

  return false;
}

const runtimeExecutable = basename(process.execPath).toLowerCase();
const isBunRuntime = runtimeExecutable.startsWith("bun");
const isCompiledRuntime = !isBunRuntime;

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const binaryDirectory = dirname(process.execPath);
const forcedMigrationsDirectory = process.env.HIVE_MIGRATIONS_DIR;
const hiveHome = resolveHiveHome();
export const pidFilePath =
  process.env.HIVE_PID_FILE ?? join(hiveHome, "hive.pid");
export const DEFAULT_WEB_PORT =
  process.env.WEB_PORT ?? (isCompiledRuntime ? String(PORT) : "3001");
const DEFAULT_CORS_ORIGINS = [
  `http://localhost:${DEFAULT_WEB_PORT}`,
  `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
];
export const DEFAULT_WEB_URL = `http://localhost:${DEFAULT_WEB_PORT}`;
//
const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
//
const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;
const allowedCorsOriginSet = new Set(allowedCorsOrigins);
const isLocalOrigin = (origin: string) =>
  origin.startsWith("http://localhost:") ||
  origin.startsWith("http://127.0.0.1:");
const isElectronDesktopOrigin = (request: Request, origin: string) => {
  if (origin !== "null") {
    return false;
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  return userAgent.includes("Electron/");
};
const resolveCorsOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  if (allowedCorsOriginSet.has(origin)) {
    return true;
  }
  if (isLocalOrigin(origin)) {
    return true;
  }
  if (isElectronDesktopOrigin(request, origin)) {
    return true;
  }
  return false;
};

const resolveMigrationsDirectory = () => {
  const candidates = [
    forcedMigrationsDirectory,
    join(binaryDirectory, "migrations"),
    join(moduleDir, "migrations"),
  ].filter((dir): dir is string => Boolean(dir));

  for (const directory of candidates) {
    if (existsSync(directory)) {
      return directory;
    }
  }

  throw new Error(
    `Can't find migrations directory. Checked: ${candidates.join(", ")}`
  );
};

const runMigrations = async (): Promise<void> => {
  try {
    const migrationsFolder = resolveMigrationsDirectory();
    await migrate(DatabaseService.db, { migrationsFolder });
    process.stderr.write("Database migrations applied.\n");
  } catch (error) {
    process.stderr.write(
      `Failed to run database migrations: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    throw error;
  }
};

const startOpencodeServer = async (workspaceRoot: string): Promise<void> => {
  const config = await loadOpencodeConfig(workspaceRoot);
  await startSharedOpencodeServer(config);
};

export const cleanupPidFile = () => {
  try {
    rmSync(pidFilePath);
  } catch {
    /* ignore pid file cleanup errors */
  }
};

const createApp = () =>
  new Elysia()
    .use(
      logger({
        level: process.env.LOG_LEVEL || "info",
        autoLogging: {
          ignore: shouldIgnoreAutoRequestLog,
        },
      })
    )

    .use(
      cors({
        origin: resolveCorsOrigin,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
      })
    )
    .get("/health", () => ({ status: "ok" }))
    .get("/api/example", () => ({
      message: "Hello from Elysia!",
      timestamp: Date.now(),
    }))
    .use(templatesRoutes)
    .use(workspacesRoutes)
    .use(cellsRoutes)
    .use(cellOpencodeRoutes)
    .use(agentsRoutes);

export type App = ReturnType<typeof createApp>;

let shuttingDown = false;
let signalsRegistered = false;

const shutdown = async (): Promise<void> => {
  await ServiceSupervisorService.stopAll();
  chatTerminalService.stopAll();
  cellTerminalService.stopAll();
  try {
    await markAgentSessionsForResume();
  } catch (failure) {
    process.stderr.write(
      `Failed to mark agent sessions for resume: ${
        failure instanceof Error ? failure.message : String(failure)
      }\n`
    );
  }
  await closeAllAgentSessions({ deleteRemote: false });
  await stopSharedOpencodeServer();
  cleanupPidFile();
};

const registerSignalHandlers = () => {
  if (signalsRegistered) {
    return;
  }
  signalsRegistered = true;

  const performShutdown = async () => {
    await shutdown();
  };

  const handleShutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    process.stderr.write(`\n${signal} received. Shutting down gracefully...\n`);

    try {
      await performShutdown();
      process.stderr.write("Cleanup completed. Exiting.\n");
      process.exit(0);
    } catch (error) {
      process.stderr.write(`Error during shutdown: ${error}\n`);
      cleanupPidFile();
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    handleShutdown("SIGTERM").catch((error) => {
      process.stderr.write(`Failed to handle SIGTERM: ${error}\n`);
    });
  });
  process.on("SIGINT", () => {
    handleShutdown("SIGINT").catch((error) => {
      process.stderr.write(`Failed to handle SIGINT: ${error}\n`);
    });
  });
};

const registerWorkspace = async (workspaceRoot: string): Promise<void> => {
  try {
    await ensureWorkspaceRegistered(workspaceRoot, {
      preserveActiveWorkspace: true,
    });
    process.stderr.write(`Workspace registered: ${workspaceRoot}\n`);
  } catch (failure) {
    process.stderr.write(
      `Warning: Failed to register workspace ${workspaceRoot}: ${
        failure instanceof Error ? failure.message : String(failure)
      }\n`
    );
  }
};

const bootstrapSupervisor = async (): Promise<void> => {
  try {
    await ServiceSupervisorService.bootstrap();
    process.stderr.write("Service supervisor initialized.\n");
  } catch (failure) {
    process.stderr.write(
      `Failed to bootstrap service supervisor: ${
        failure instanceof Error ? failure.message : String(failure)
      }\n`
    );
  }
};

const resumeProvisioning = async (): Promise<void> => {
  try {
    await resumeSpawningCells();
  } catch (failure) {
    process.stderr.write(
      `Failed to resume cell provisioning: ${
        failure instanceof Error ? failure.message : String(failure)
      }\n`
    );
  }
};

const startAllServices = async (): Promise<void> => {
  const allCells = await DatabaseService.db.select().from(cells);
  if (allCells.length === 0) {
    return;
  }

  for (const cell of allCells) {
    try {
      await ServiceSupervisorService.startCellServices(cell.id);
    } catch (failure) {
      process.stderr.write(
        `Failed to start services for cell ${cell.id}: ${
          failure instanceof Error ? failure.message : String(failure)
        }\n`
      );
    }
  }
};

const resumeAgentSessions = async (): Promise<void> => {
  try {
    await resumeAgentSessionsOnStartup();
  } catch (failure) {
    process.stderr.write(
      `Failed to resume agent sessions: ${
        failure instanceof Error ? failure.message : String(failure)
      }\n`
    );
  }
};

const bootstrapServer = async (workspaceRoot: string): Promise<void> => {
  await runMigrations();
  await registerWorkspace(workspaceRoot);
  await startOpencodeServer(workspaceRoot);
  await bootstrapSupervisor();
  await resumeProvisioning();
  await startAllServices();
  await resumeAgentSessions();
};

export const startServer = async () => {
  const app = createApp();

  app.get("/", () => "OK");

  const workspaceRoot = resolveWorkspaceRoot();

  try {
    await bootstrapServer(workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}\nStartup failed. Check the logs above for details; database issues may require rerunning migrations with ` +
        "`bun run db:push` (repo root) or `bun -C apps/server run db:push`.\n"
    );
    cleanupPidFile();
    process.exit(1);
  }

  registerSignalHandlers();

  try {
    app.listen({
      port: PORT,
      hostname: HOSTNAME,
      reusePort: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    process.stderr.write(
      `Failed to bind API port ${PORT}: ${message}. Is another process using this port?\n`
    );
    cleanupPidFile();
    process.exit(1);
  }

  const boundPort = app.server?.port ?? PORT;
  const boundHostname = app.server?.hostname ?? HOSTNAME;
  process.stderr.write(
    `API listening on http://${boundHostname}:${boundPort}\n`
  );

  return app;
};
