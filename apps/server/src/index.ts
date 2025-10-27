import "dotenv/config";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import pino from "pino";

const PORT = 3000;

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss",
          },
        }
      : undefined,
});

const app = new Elysia()
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    logger.info({ method: request.method, path: url.pathname }, "Request");
  })
  .use(
    cors({
      origin: process.env.CORS_ORIGIN || "",
      methods: ["GET", "POST", "OPTIONS"],
    })
  )
  .get("/", () => "OK")
  .get("/api/example", () => ({
    message: "Hello from Elysia!",
    timestamp: Date.now(),
  }))
  .listen(PORT);

export type App = typeof app;
