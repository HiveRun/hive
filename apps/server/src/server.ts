import "dotenv/config";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "@bogeychan/elysia-logger";

import { cors } from "@elysiajs/cors";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Effect } from "effect";
import { Elysia } from "elysia";
import { loadOpencodeConfig } from "./agents/opencode-config";
import {
  startSharedOpencodeServer,
  stopSharedOpencodeServer,
} from "./agents/opencode-server";
import { closeAllAgentSessions } from "./agents/service";
import { resolveWorkspaceRoot } from "./config/context";
import { DatabaseService } from "./db";
import { agentsRoutes } from "./routes/agents";
import { cellsRoutes, resumeSpawningCells } from "./routes/cells";
import { templatesRoutes } from "./routes/templates";
import { workspacesRoutes } from "./routes/workspaces";
import { runServerEffect } from "./runtime";
import { ServiceSupervisorService } from "./services/supervisor";
import {
  ensureWorkspaceRegisteredEffect,
  resolveHiveHome,
} from "./workspaces/registry";

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_HOSTNAME = "localhost";
const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const HOSTNAME = process.env.HOST ?? process.env.HOSTNAME ?? DEFAULT_HOSTNAME;

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
  "tauri://localhost",
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

const runMigrationsEffect = Effect.flatMap(DatabaseService, ({ db }) =>
  Effect.tryPromise({
    try: async () => {
      const migrationsFolder = resolveMigrationsDirectory();
      await migrate(db, { migrationsFolder });
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => process.stderr.write("Database migrations applied.\n"))
    ),
    Effect.tapError((error) =>
      Effect.sync(() =>
        process.stderr.write(
          `Failed to run database migrations: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        )
      )
    )
  )
);

const startOpencodeServerEffect = (workspaceRoot: string) =>
  Effect.tryPromise({
    try: async () => {
      const config = await loadOpencodeConfig(workspaceRoot);
      await startSharedOpencodeServer(config);
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });

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
    .use(agentsRoutes);

export type App = ReturnType<typeof createApp>;

let shuttingDown = false;
let signalsRegistered = false;

const shutdownEffect = Effect.gen(function* () {
  yield* ServiceSupervisorService.pipe(
    Effect.flatMap((service) => service.stopAll)
  );
  yield* Effect.tryPromise({
    try: () => closeAllAgentSessions(),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
  yield* Effect.tryPromise({
    try: () => stopSharedOpencodeServer(),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
  yield* Effect.sync(cleanupPidFile);
});

const registerSignalHandlers = () => {
  if (signalsRegistered) {
    return;
  }
  signalsRegistered = true;

  const performShutdown = async () => {
    await runServerEffect(shutdownEffect);
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

const registerWorkspaceEffect = (workspaceRoot: string) =>
  ensureWorkspaceRegisteredEffect(workspaceRoot, {
    preserveActiveWorkspace: true,
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() =>
        process.stderr.write(`Workspace registered: ${workspaceRoot}\n`)
      )
    ),
    Effect.catchAll((failure) =>
      Effect.sync(() =>
        process.stderr.write(
          `Warning: Failed to register workspace ${workspaceRoot}: ${
            failure instanceof Error ? failure.message : String(failure)
          }\n`
        )
      )
    )
  );

const bootstrapSupervisorEffect = ServiceSupervisorService.pipe(
  Effect.flatMap((service) => service.bootstrap),
  Effect.tap(() =>
    Effect.sync(() => process.stderr.write("Service supervisor initialized.\n"))
  ),
  Effect.catchAll((failure) =>
    Effect.sync(() =>
      process.stderr.write(
        `Failed to bootstrap service supervisor: ${
          failure instanceof Error ? failure.message : String(failure)
        }\n`
      )
    )
  )
);

const resumeProvisioningEffect = Effect.tryPromise({
  try: () => resumeSpawningCells(),
  catch: (failure) =>
    failure instanceof Error ? failure : new Error(String(failure)),
}).pipe(
  Effect.catchAll((failure) =>
    Effect.sync(() =>
      process.stderr.write(
        `Failed to resume cell provisioning: ${
          failure instanceof Error ? failure.message : String(failure)
        }\n`
      )
    )
  )
);

const bootstrapServerEffect = (workspaceRoot: string) =>
  Effect.gen(function* () {
    yield* runMigrationsEffect;
    yield* registerWorkspaceEffect(workspaceRoot);
    yield* startOpencodeServerEffect(workspaceRoot);
    yield* bootstrapSupervisorEffect;
    yield* resumeProvisioningEffect;
  });

export const startServer = async () => {
  const app = createApp();

  app.get("/", () => "OK");

  const workspaceRoot = resolveWorkspaceRoot();

  try {
    await runServerEffect(bootstrapServerEffect(workspaceRoot));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}\nStartup failed. Check the logs above for details; database issues may require rerunning migrations with ` +
        "`bun run apps/server db:push`.\n"
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
