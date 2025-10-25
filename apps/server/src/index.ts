import "dotenv/config";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

const PORT = 3000;

new Elysia()
  .use(
    cors({
      origin: process.env.CORS_ORIGIN || "",
      methods: ["GET", "POST", "OPTIONS"],
    })
  )
  .get("/", () => "OK")
  .listen(PORT);
