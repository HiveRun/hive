import "dotenv/config";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

const PORT = 3000;

const app = new Elysia()
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
