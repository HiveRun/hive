import "dotenv/config";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { agentsRoutes } from "./routes/agents";
import { constructsRoutes } from "./routes/constructs";
import { templatesRoutes } from "./routes/templates";

const PORT = 3000;

const DEFAULT_CORS_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001"];

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

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
  .listen(PORT);

export type App = typeof app;
