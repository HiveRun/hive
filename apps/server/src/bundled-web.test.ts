import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { afterEach, describe, expect, it } from "vitest";
import { createBundledWebHandler } from "./bundled-web";

const directories: string[] = [];
const HTTP_NOT_FOUND = 404;

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

const createWebDist = async () => {
  const directory = await mkdtemp(join(tmpdir(), "hive-bundled-web-"));
  directories.push(directory);
  await mkdir(join(directory, "assets"));
  await Promise.all([
    writeFile(
      join(directory, "index.html"),
      "<html><head></head><body><main>Hive</main></body></html>"
    ),
    writeFile(join(directory, "assets", "app.js"), "export default 'hive'"),
  ]);
  return directory;
};

describe("bundled web handler", () => {
  it("serves assets and the SPA shell for direct navigation", async () => {
    const handler = createBundledWebHandler(await createWebDist());
    expect(handler).toBeDefined();

    const asset = handler?.(new Request("http://localhost/assets/app.js"));
    const route = handler?.(
      new Request("http://localhost/cells/cell-id/viewer")
    );
    const routeHtml = await route?.text();

    expect(await asset?.text()).toBe("export default 'hive'");
    expect(routeHtml).toContain('<base href="/">');
    expect(routeHtml).toContain("<main>Hive</main>");
    expect(route?.headers.get("cache-control")).toBe("no-cache");
    expect(route?.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("preserves API and missing asset 404 responses", async () => {
    const handler = createBundledWebHandler(await createWebDist());

    const api = handler?.(new Request("http://localhost/api/missing"));
    const asset = handler?.(new Request("http://localhost/assets/missing.js"));
    const traversal = handler?.(
      new Request("http://localhost/%2e%2e/package.json")
    );

    expect(api?.status).toBe(HTTP_NOT_FOUND);
    expect(asset?.status).toBe(HTTP_NOT_FOUND);
    expect(traversal?.status).toBe(HTTP_NOT_FOUND);
  });

  it("does not shadow exact server routes when mounted as a wildcard", async () => {
    const handler = createBundledWebHandler(await createWebDist());
    const app = new Elysia()
      .get("/health", () => "OK")
      .get("/api/value", () => ({ value: "api" }))
      .get("/*", ({ request }) => handler?.(request));

    const [health, api, route] = await Promise.all([
      app.handle(new Request("http://localhost/health")),
      app.handle(new Request("http://localhost/api/value")),
      app.handle(new Request("http://localhost/cells/cell-id/viewer")),
    ]);

    expect(await health.text()).toBe("OK");
    expect(await api.json()).toEqual({ value: "api" });
    expect(await route.text()).toContain('<base href="/">');
  });
});
