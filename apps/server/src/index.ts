import "dotenv/config";
import { resolve } from "node:path";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { createDb, ensureDatabase } from "./db";
import { defineSyntheticConfig } from "./lib/config";
import { agentsRoute } from "./routes/agents";
import { constructsRoute } from "./routes/constructs";
import { servicesRoutes } from "./routes/services";
import { templatesRoute } from "./routes/templates";

const PORT = 3000;

const DEFAULT_CORS_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001"];

const resolvedCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins =
  resolvedCorsOrigins.length > 0 ? resolvedCorsOrigins : DEFAULT_CORS_ORIGINS;

// Initialize database
await ensureDatabase();
const db = createDb();

// Load workspace configuration
const workspacePath = resolve(process.cwd(), "../..");
const config = defineSyntheticConfig({
  opencode: {
    workspaceId: process.env.OPENCODE_WORKSPACE_ID || "dev-workspace",
    token: process.env.OPENCODE_TOKEN,
  },
  promptSources: [
    { path: "docs/prompts/base-brief.md", order: 0 },
    { path: "docs/prompts/**/*.md", order: 10 },
  ],
  templates: [
    {
      id: "full-stack-dev",
      label: "Full Stack Development",
      summary: "Complete development environment with web and API servers",
      type: "implementation",
      services: [
        {
          type: "process",
          id: "web",
          name: "Web Dev Server",
          run: "bun run dev:web",
          ports: [{ name: "web", preferred: 3001, env: "WEB_PORT" }],
          readyPattern: "Local:\\s+http://",
        },
        {
          type: "process",
          id: "server",
          name: "API Server",
          run: "bun run dev:server",
          ports: [{ name: "api", preferred: 3000, env: "API_PORT" }],
          readyPattern: "Server running",
        },
      ],
    },
    {
      id: "planning",
      label: "Planning Session",
      summary: "Planning-mode agent for design and architecture work",
      type: "planning",
    },
    {
      id: "manual",
      label: "Manual Workspace",
      summary: "Isolated workspace without agent assistance",
      type: "manual",
    },
  ],
});

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
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  )
  .get("/", () => "Synthetic API")
  .get("/api/health", () => ({
    status: "ok",
    timestamp: Date.now(),
  }))
  .use(constructsRoute(db, config, workspacePath))
  .use(templatesRoute(config))
  .use(agentsRoute(db))
  .use(servicesRoutes)
  .listen(PORT);

export type App = typeof app;
