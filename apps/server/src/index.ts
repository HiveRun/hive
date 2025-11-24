import "dotenv/config";
import { basename } from "node:path";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Elysia } from "elysia";
import { cleanupOrphanedServers } from "./agents/cleanup";
import { closeAllAgentSessions } from "./agents/service";
import { resolveWorkspaceRoot } from "./config/context";
import { resolveStaticAssetsDirectory } from "./config/static-assets";
import { db } from "./db";
import { agentsRoutes } from "./routes/agents";
import { constructsRoutes } from "./routes/constructs";
import { templatesRoutes } from "./routes/templates";
import { preloadVoiceTranscriptionModels, voiceRoutes } from "./routes/voice";
import { workspacesRoutes } from "./routes/workspaces";
import { constructs } from "./schema/constructs";
import {
  bootstrapServiceSupervisor,
  stopAllServices,
} from "./services/supervisor";
import { ensureWorkspaceRegistered } from "./workspaces/registry";

const DEFAULT_SERVER_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

const runtimeExecutable = basename(process.execPath).toLowerCase();
const isBunRuntime = runtimeExecutable.startsWith("bun");
const isCompiledRuntime = !isBunRuntime;

async function startupCleanup() {
  process.stderr.write("Checking for orphaned OpenCode processes...\n");

  const activeConstructs = await db
    .select({ port: constructs.opencodeServerPort })
    .from(constructs);

  const ports = activeConstructs
    .map((c) => c.port)
    .filter((p): p is number => p !== null);

  if (ports.length === 0) {
    process.stderr.write("No OpenCode ports to clean up.\n");
    return;
  }

  const { cleaned, failed } = await cleanupOrphanedServers(ports);

  if (cleaned.length > 0) {
    process.stderr.write(
      `Cleaned up ${cleaned.length} orphaned OpenCode process(es) on ports: ${cleaned.join(", ")}\n`
    );
  }

  if (failed.length > 0) {
    process.stderr.write(
      `Warning: Failed to clean up ${failed.length} process(es) on ports: ${failed.join(", ")}\n`
    );
  }
}

const DEFAULT_WEB_PORT = process.env.WEB_PORT ?? "3001";
const DEFAULT_CORS_ORIGINS = [
  `http://localhost:${DEFAULT_WEB_PORT}`,
  `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
];

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

async function runMigrations() {
  const migrationsFolder = new URL("./migrations", import.meta.url).pathname;
  try {
    await migrate(db, { migrationsFolder });
    process.stderr.write("Database migrations applied.\n");
  } catch (error) {
    process.stderr.write(
      `Failed to run database migrations: ${error instanceof Error ? error.message : String(error)}\n`
    );
    throw error;
  }
}

const app = new Elysia()
  .use(
    logger({
      level: process.env.LOG_LEVEL || "info",
    })
  )

  .use(
    cors({
      origin: allowedCorsOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    })
  )
  .get("/", () => "OK")
  .get("/health", () => ({ status: "ok" }))
  .get("/api/example", () => ({
    message: "Hello from Elysia!",
    timestamp: Date.now(),
  }))
  .use(templatesRoutes)
  .use(workspacesRoutes)
  .use(constructsRoutes)
  .use(agentsRoutes)
  .use(voiceRoutes);

const staticAssetsDirectory = resolveStaticAssetsDirectory();
const shouldServeStaticAssets =
  Boolean(staticAssetsDirectory) &&
  (isCompiledRuntime ||
    Boolean(process.env.SYNTHETIC_WEB_DIST) ||
    process.env.SYNTHETIC_FORCE_STATIC === "1");

if (shouldServeStaticAssets && staticAssetsDirectory) {
  app.use(
    staticPlugin({
      assets: staticAssetsDirectory,
      prefix: "/",
      indexHTML: true,
      alwaysStatic: true,
    })
  );
  process.stderr.write(
    `Serving frontend assets from: ${staticAssetsDirectory}\n`
  );
} else if (staticAssetsDirectory) {
  process.stderr.write(
    "Frontend build detected but static serving is disabled in this runtime.\n"
  );
} else {
  process.stderr.write("No frontend build detected; API-only mode.\n");
}

const startApplication = async () => {
  try {
    await runMigrations();
  } catch (error) {
    process.stderr.write(
      "Running migrations failed. To bootstrap a fresh install, run `synthetic --init-db` or `bun run apps/server db:push` from the repo.\n"
    );
    throw error;
  }

  await startupCleanup();

  const workspaceRoot = resolveWorkspaceRoot();
  try {
    await ensureWorkspaceRegistered(workspaceRoot, {
      preserveActiveWorkspace: true,
    });
    process.stderr.write(`Workspace registered: ${workspaceRoot}\n`);
  } catch (error) {
    process.stderr.write(
      `Warning: Failed to register workspace ${workspaceRoot}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  try {
    await bootstrapServiceSupervisor();
    process.stderr.write("Service supervisor initialized.\n");
  } catch (error) {
    process.stderr.write(
      `Failed to bootstrap service supervisor: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  await preloadVoiceTranscriptionModels();

  app.listen(PORT);
};

startApplication().catch((error) => {
  process.stderr.write(
    `Failed to start Synthetic: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`
  );
  process.exit(1);
});

export type App = typeof app;

let shuttingDown = false;

async function handleShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  process.stderr.write(`\n${signal} received. Shutting down gracefully...\n`);

  try {
    await stopAllServices();
    await closeAllAgentSessions();
    process.stderr.write("Cleanup completed. Exiting.\n");
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Error during shutdown: ${error}\n`);
    process.exit(1);
  }
}

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
