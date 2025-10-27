import "dotenv/config";
import { logger } from "@bogeychan/elysia-logger";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

const PORT = 3000;

const app = new Elysia()
  .use(
    logger({
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss.l",
                ignore: "pid,hostname",
                singleLine: false,
                messageFormat:
                  "{msg} {req.method} {req.url} {res.statusCode} {responseTime}ms",
                customPrettifiers: {
                  time: (timestamp: string) => `🕐 ${timestamp}`,
                },
              },
            }
          : undefined,
    })
  )
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
