import "dotenv/config";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { cleanupOrphanedServers } from "./agents/cleanup";
import { closeAllAgentSessions } from "./agents/service";
import { db } from "./db";
import { agentsRoutes } from "./routes/agents";
import { constructsRoutes } from "./routes/constructs";
import { templatesRoutes } from "./routes/templates";
import { preloadVoiceTranscriptionModels, voiceRoutes } from "./routes/voice";
import { constructs } from "./schema/constructs";
import {
  bootstrapServiceSupervisor,
  stopAllServices,
} from "./services/supervisor";

const DEFAULT_SERVER_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

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

await startupCleanup();

try {
  await bootstrapServiceSupervisor();
  process.stderr.write("Service supervisor initialized.\n");
} catch (error) {
  process.stderr.write(
    `Failed to bootstrap service supervisor: ${error instanceof Error ? error.message : String(error)}\n`
  );
}

await preloadVoiceTranscriptionModels();

const app = new Elysia()
  .use(
    logger({
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty" }
          : undefined,
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
  .get("/api/example", () => ({
    message: "Hello from Elysia!",
    timestamp: Date.now(),
  }))
  .use(templatesRoutes)
  .use(constructsRoutes)
  .use(agentsRoutes)
  .use(voiceRoutes)
  .listen(PORT);

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
