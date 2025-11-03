import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";

const createTestApp = () =>
  new Elysia()
    .use(
      cors({
        origin: "",
        methods: ["GET", "POST", "OPTIONS"],
      })
    )
    .get("/", () => "OK");

describe("Server", () => {
  it("should respond with OK on GET /", async () => {
    const app = createTestApp();

    const res = await app.handle(new Request("http://localhost/"));
    const response = await res.text();

    expect(response).toBe("OK");
  });

  it("should handle CORS preflight requests", async () => {
    const app = createTestApp();

    const res = await app.handle(
      new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "GET",
        },
      })
    );

    const CORS_PREFLIGHT_STATUS = 204;
    expect(res.status).toBe(CORS_PREFLIGHT_STATUS);
  });
});
