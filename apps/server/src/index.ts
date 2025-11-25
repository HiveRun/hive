import "dotenv/config";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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

const moduleDir = dirname(fileURLToPath(import.meta.url));
const binaryDirectory = dirname(process.execPath);
const forcedMigrationsDirectory = process.env.SYNTHETIC_MIGRATIONS_DIR;
const pidFilePath =
  process.env.SYNTHETIC_PID_FILE ?? join(binaryDirectory, "synthetic.pid");
const isForcedForeground = process.env.SYNTHETIC_FOREGROUND === "1";
const shouldRunDetached = isCompiledRuntime && !isForcedForeground;

const resolveLogDirectory = () =>
  process.env.SYNTHETIC_LOG_DIR ?? join(binaryDirectory, "logs");
const resolveLogFilePath = () => join(resolveLogDirectory(), "synthetic.log");

const cliArgs = process.argv.slice(2);
const isStopCommand = cliArgs[0] === "stop";
const isLogsCommand = cliArgs[0] === "logs";
const isUpgradeCommand = cliArgs[0] === "upgrade";

const ensureLogDirectory = (dir: string) => {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
};

const cleanupPidFile = () => {
  try {
    rmSync(pidFilePath);
  } catch {
    /* ignore */
  }
};

const terminateBackgroundProcess = () => {
  if (!existsSync(pidFilePath)) {
    process.stdout.write("No running Synthetic instance found.\n");
    return false;
  }

  let pidText: string;
  try {
    pidText = readFileSync(pidFilePath, "utf8").trim();
  } catch (error) {
    process.stderr.write(
      `Unable to read pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return false;
  }

  const pid = Number(pidText);
  if (!pid || Number.isNaN(pid)) {
    process.stderr.write(`Pid file ${pidFilePath} contains invalid data.\n`);
    cleanupPidFile();
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    process.stdout.write(`Stopped Synthetic (PID ${pid}).\n`);
  } catch (error) {
    process.stderr.write(
      `Failed to stop Synthetic (PID ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return false;
  }

  cleanupPidFile();
  return true;
};

const stopBackgroundServer = () => {
  const success = terminateBackgroundProcess();
  process.exit(success ? 0 : 1);
};

const streamLogs = () => {
  const logFile = resolveLogFilePath();
  if (!existsSync(logFile)) {
    process.stderr.write(
      `No log file found at ${logFile}. Start Synthetic before streaming logs.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `Streaming logs from ${logFile}. Press Ctrl+C to stop.\n\n`
  );

  let position = 0;

  const readNewData = () => {
    const stats = statSync(logFile);
    if (stats.size < position) {
      position = 0;
    }
    if (stats.size === position) {
      return;
    }
    const length = stats.size - position;
    const buffer = Buffer.alloc(length);
    const fd = openSync(logFile, "r");
    readSync(fd, buffer, 0, length, position);
    closeSync(fd);
    position = stats.size;
    process.stdout.write(buffer.toString("utf8"));
  };

  readNewData();

  const watcher = watch(logFile, { persistent: true }, () => {
    try {
      readNewData();
    } catch (error) {
      process.stderr.write(
        `Failed to read log updates: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
    }
  });

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

const runUpgrade = () => {
  const stopped = terminateBackgroundProcess();
  if (!stopped) {
    process.stdout.write(
      "No running instance detected or stop failed. Continuing upgrade.\n"
    );
  }

  const installCommand =
    process.env.SYNTHETIC_INSTALL_COMMAND ??
    "curl -fsSL https://raw.githubusercontent.com/SyntheticRun/synthetic/main/scripts/install.sh | bash";

  process.stdout.write("Downloading and installing the latest release...\n");
  const child = spawn("bash", ["-c", installCommand], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    const exitCode = code ?? 0;
    if (exitCode === 0) {
      process.stdout.write(
        "Synthetic upgraded successfully. Run `synthetic` to start the new version.\n"
      );
    }
    process.exit(exitCode);
  });
};

const LEADING_SLASH_REGEX = /^\/+/,
  DOT_SEQUENCE_REGEX = /\.\.+/g;

const sanitizeAssetPath = (pathname: string) =>
  pathname.replace(LEADING_SLASH_REGEX, "").replace(DOT_SEQUENCE_REGEX, "");

const resolveAssetPath = (pathname: string, assetsDir: string) => {
  const [rawPath] = pathname.split("?");
  const cleanPath = sanitizeAssetPath(rawPath ?? "");
  const explicitPath = cleanPath.length > 0 ? cleanPath : "index.html";
  const candidate = join(assetsDir, explicitPath);
  if (existsSync(candidate) && !candidate.endsWith("/")) {
    return candidate;
  }

  const nestedIndex = join(assetsDir, explicitPath, "index.html");
  if (existsSync(nestedIndex)) {
    return nestedIndex;
  }

  const fallback = join(assetsDir, "index.html");
  if (existsSync(fallback)) {
    return fallback;
  }

  return null;
};

const registerStaticAssets = (assetsDir: string) => {
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

const startDetachedServer = () => {
  const logDir = resolveLogDirectory();
  ensureLogDirectory(logDir);
  const logFile = resolveLogFilePath();
  const stdoutFd = openSync(logFile, "a");
  const stderrFd = openSync(logFile, "a");

  const child = spawn(process.execPath, ["--foreground"], {
    cwd: binaryDirectory,
    env: {
      ...process.env,
      SYNTHETIC_FOREGROUND: "1",
    },
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);

  child.unref();

  const pidFile = join(binaryDirectory, "synthetic.pid");
  try {
    writeFileSync(pidFile, String(child.pid));
  } catch (error) {
    process.stderr.write(
      `Failed to write pid file ${pidFile}: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }

  const lines = [
    "Synthetic is running in the background.",
    `UI: ${DEFAULT_WEB_URL}`,
    `Logs: ${logFile}`,
    `PID file: ${pidFilePath}`,
    "Stop with: synthetic stop",
    "Tail logs with: synthetic logs",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
};

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

const DEFAULT_WEB_PORT =
  process.env.WEB_PORT ?? (isCompiledRuntime ? String(PORT) : "3001");
const DEFAULT_CORS_ORIGINS = [
  `http://localhost:${DEFAULT_WEB_PORT}`,
  `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
];
const DEFAULT_WEB_URL = `http://localhost:${DEFAULT_WEB_PORT}`;

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

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
  registerStaticAssets(staticAssetsDirectory);
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

const startApplication = async () => {
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

const bootstrap = async () => {
  if (shouldRunDetached) {
    try {
      startDetachedServer();
      return;
    } catch (error) {
      process.stderr.write(
        `Failed to launch background process: ${
          error instanceof Error ? error.message : String(error)
        }. Falling back to foreground mode.\n`
      );
    }
  }

  await startApplication();
};

const run = async () => {
  if (isStopCommand) {
    stopBackgroundServer();
    return;
  }

  if (isLogsCommand) {
    streamLogs();
    return;
  }

  if (isUpgradeCommand) {
    runUpgrade();
    return;
  }

  await bootstrap();
};

run().catch((error) => {
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
    cleanupPidFile();
    process.stderr.write("Cleanup completed. Exiting.\n");
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Error during shutdown: ${error}\n`);
    cleanupPidFile();
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
