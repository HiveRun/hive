import "dotenv/config";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { db } from "./db";
import { cleanupOrphanedServers } from "./opencode/cleanup";
import { closeAllInstances } from "./opencode/service";
import { agentsRoutes } from "./routes/agents";
import { constructsRoutes } from "./routes/constructs";
import { opencodeTestRoutes } from "./routes/opencode-test";
import { templatesRoutes } from "./routes/templates";
import { constructs } from "./schema/constructs";

const PORT = 3000;

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

const DEFAULT_CORS_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001"];

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

await startupCleanup();

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
  .use(opencodeTestRoutes)
  .listen(PORT);

export type App = typeof app;

function handleShutdown(signal: string) {
  process.stderr.write(`\n${signal} received. Shutting down gracefully...\n`);

  try {
    closeAllInstances();
    process.stderr.write("Cleanup completed. Exiting.\n");
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Error during shutdown: ${error}\n`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
