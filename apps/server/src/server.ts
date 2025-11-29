import "dotenv/config";
import { existsSync, rmSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "@bogeychan/elysia-logger";

import { cors } from "@elysiajs/cors";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Elysia } from "elysia";
import { cleanupOrphanedServers } from "./agents/cleanup";
import { closeAllAgentSessions } from "./agents/service";
import { resolveWorkspaceRoot } from "./config/context";
import { resolveStaticAssetsDirectory } from "./config/static-assets";
import { db } from "./db";
import { agentsRoutes } from "./routes/agents";
import { cellsRoutes } from "./routes/cells";
import { templatesRoutes } from "./routes/templates";
import { preloadVoiceTranscriptionModels, voiceRoutes } from "./routes/voice";
import { workspacesRoutes } from "./routes/workspaces";
import { cells } from "./schema/cells";
import {
  bootstrapServiceSupervisor,
  stopAllServices,
} from "./services/supervisor";
import {
  ensureWorkspaceRegistered,
  resolveHiveHome,
} from "./workspaces/registry";

const DEFAULT_SERVER_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

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

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

const LEADING_SLASH_REGEX = /^\/+/,
  DOT_SEQUENCE_REGEX = /\.\.+/g;

const sanitizeAssetPath = (pathname: string) =>
  pathname.replace(LEADING_SLASH_REGEX, "").replace(DOT_SEQUENCE_REGEX, "");

const resolvePathWithin = (root: string, target: string) => {
  const absolute = resolve(root, target);
  const relativePath = relative(root, absolute);
  if (relativePath === "") {
    return absolute;
  }
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return absolute;
};

const resolveExistingFile = (filePath?: string | null) => {
  if (!filePath) {
    return null;
  }
  try {
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      return filePath;
    }
  } catch {
    /* ignore filesystem errors */
  }
  return null;
};

const resolveAssetPath = (pathname: string, assetsDir: string) => {
  const [rawPath] = pathname.split("?");
  const cleanPath = sanitizeAssetPath(rawPath ?? "");
  const explicitPath = cleanPath.length > 0 ? cleanPath : "index.html";

  const direct = resolveExistingFile(
    resolvePathWithin(assetsDir, explicitPath)
  );
  if (direct) {
    return direct;
  }

  const nestedIndex = resolveExistingFile(
    resolvePathWithin(assetsDir, join(explicitPath, "index.html"))
  );
  if (nestedIndex) {
    return nestedIndex;
  }

  return resolveExistingFile(resolvePathWithin(assetsDir, "index.html"));
};

const registerStaticAssets = (app: App, assetsDir: string) => {
  const sendFile = (pathname: string) => {
    const filePath = resolveAssetPath(pathname, assetsDir);
    if (!filePath) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(Bun.file(filePath));
  };

  const sendHead = (pathname: string) => {
    const filePath = resolveAssetPath(pathname, assetsDir);
    if (!filePath) {
      return new Response(null, { status: 404 });
    }
    const file = Bun.file(filePath);
    const response = new Response(null, { status: 200 });
    if (file.type) {
      response.headers.set("content-type", file.type);
    }
    response.headers.set("content-length", file.size.toString());
    return response;
  };

  app.get("/*", ({ request }) => sendFile(new URL(request.url).pathname));
  app.get("/", ({ request }) => sendFile(new URL(request.url).pathname));

  app.head("/*", ({ request }) => sendHead(new URL(request.url).pathname));
  app.head("/", ({ request }) => sendHead(new URL(request.url).pathname));
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

async function runMigrations() {
  const migrationsFolder = resolveMigrationsDirectory();
  try {
    await migrate(db, { migrationsFolder });
    process.stderr.write("Database migrations applied.\n");
  } catch (error) {
    process.stderr.write(
      `Failed to run database migrations: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    throw error;
  }
}

async function startupCleanup() {
  process.stderr.write("Checking for orphaned OpenCode processes...\n");

  const activeCells = await db
    .select({ port: cells.opencodeServerPort })
    .from(cells);

  const ports = activeCells
    .map((c) => c.port)
    .filter((p): p is number => p !== null);

  if (ports.length === 0) {
    process.stderr.write("No OpenCode ports to clean up.\n");
    return;
  }

  const { cleaned, failed } = await cleanupOrphanedServers(ports);

  if (cleaned.length > 0) {
    process.stderr.write(
      `Cleaned up ${cleaned.length} orphaned OpenCode process(es) on ports: ${cleaned.join(", ")}` +
        "\n"
    );
  }

  if (failed.length > 0) {
    process.stderr.write(
      `Warning: Failed to clean up ${failed.length} process(es) on ports: ${failed.join(", ")}` +
        "\n"
    );
  }
}

export const cleanupPidFile = () => {
  try {
    rmSync(pidFilePath);
  } catch {
    /* ignore */
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
        origin: allowedCorsOrigins,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
    .use(agentsRoutes)
    .use(voiceRoutes);

export type App = ReturnType<typeof createApp>;

let shuttingDown = false;
let signalsRegistered = false;

const registerSignalHandlers = () => {
  if (signalsRegistered) {
    return;
  }
  signalsRegistered = true;

  const handleShutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    process.stderr.write(`\n${signal} received. Shutting down gracefully...\n`);

    try {
      await stopAllServices();
      await closeAllAgentSessions();
      cleanupPidFile();
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

export const startServer = async () => {
  const app = createApp();

  const staticAssetsDirectory = resolveStaticAssetsDirectory();
  const shouldServeStaticAssets =
    Boolean(staticAssetsDirectory) &&
    (isCompiledRuntime ||
      Boolean(process.env.HIVE_WEB_DIST) ||
      process.env.HIVE_FORCE_STATIC === "1");

  if (shouldServeStaticAssets && staticAssetsDirectory) {
    registerStaticAssets(app, staticAssetsDirectory);
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

  if (!shouldServeStaticAssets) {
    app.get("/", () => "OK");
  }

  try {
    await runMigrations();
  } catch (error) {
    process.stderr.write(
      "Running migrations failed. Delete the database defined in DATABASE_URL or rerun `bun run apps/server db:push` from source to recover.\n"
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
      `Warning: Failed to register workspace ${workspaceRoot}: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }

  try {
    await bootstrapServiceSupervisor();
    process.stderr.write("Service supervisor initialized.\n");
  } catch (error) {
    process.stderr.write(
      `Failed to bootstrap service supervisor: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }

  await preloadVoiceTranscriptionModels();

  registerSignalHandlers();
  app.listen(PORT);

  return app;
};
