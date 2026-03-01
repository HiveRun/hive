import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpencodeProxyTargetUrl,
  proxyOpencodeRequest,
} from "./opencode-proxy";

const HTTP_OK = 200;

describe("buildOpencodeProxyTargetUrl", () => {
  it("forwards direct API paths to the shared OpenCode server", () => {
    const target = buildOpencodeProxyTargetUrl({
      requestUrl: "http://hive.local/api/cells/cell-1/opencode/proxy/session",
      cellId: "cell-1",
      upstreamBaseUrl: "http://127.0.0.1:4096",
    });

    expect(target.toString()).toBe("http://127.0.0.1:4096/session");
  });

  it("strips workspace-prefixed API paths before forwarding", () => {
    const target = buildOpencodeProxyTargetUrl({
      requestUrl:
        "http://hive.local/api/cells/cell-1/opencode/proxy/AbCdEfGhIjKlMnOp/find/global/experimental?query=test",
      cellId: "cell-1",
      upstreamBaseUrl: "http://127.0.0.1:4096",
    });

    expect(target.toString()).toBe(
      "http://127.0.0.1:4096/find/global/experimental?query=test"
    );
  });

  it("routes app paths through root and injects hive_app_path", () => {
    const target = buildOpencodeProxyTargetUrl({
      requestUrl:
        "http://hive.local/api/cells/cell-1/opencode/proxy/AbCdEfGhIjKlMnOp/session/session-123?foo=bar",
      cellId: "cell-1",
      upstreamBaseUrl: "http://127.0.0.1:4096",
    });

    expect(target.pathname).toBe("/");
    expect(target.searchParams.get("foo")).toBe("bar");
    expect(target.searchParams.get("hive_app_path")).toBe(
      "/AbCdEfGhIjKlMnOp/session/session-123"
    );
  });
});

describe("proxyOpencodeRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns generated Hive embed CSS without hitting upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const request = new Request(
      "http://hive.local/proxy/hive-opencode-embed.css"
    );

    const response = await proxyOpencodeRequest({
      request,
      targetUrl: new URL("http://127.0.0.1:4096/hive-opencode-embed.css"),
      proxyBasePath: "/api/cells/cell-1/opencode/proxy",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe(
      "text/css; charset=utf-8"
    );
    expect(await response.text()).toContain("--surface-brand-base: #f5a524");
  });

  it("rewrites HTML assets and preload params for iframe proxying", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<html><head></head><body><script src="/assets/app.js"></script><script src="oc-theme-preload.js"></script></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      )
    );

    const request = new Request(
      "http://hive.local/api/cells/cell-1/opencode/proxy/?hive_app_path=%2FAbCdEfGhIjKlMnOp%2Fsession%2Fsession-123&hive_color_scheme=dark"
    );

    const response = await proxyOpencodeRequest({
      request,
      targetUrl: new URL(
        "http://127.0.0.1:4096/?hive_app_path=%2FAbCdEfGhIjKlMnOp%2Fsession%2Fsession-123&hive_color_scheme=dark"
      ),
      proxyBasePath: "/api/cells/cell-1/opencode/proxy",
    });

    const html = await response.text();
    expect(html).toContain('<base href="/api/cells/cell-1/opencode/proxy/" />');
    expect(html).toContain(
      'src="/api/cells/cell-1/opencode/proxy/assets/app.js"'
    );
    expect(html).toContain(
      "oc-theme-preload.js?hive_proxy=2&hive_app_path=%2FAbCdEfGhIjKlMnOp%2Fsession%2Fsession-123&hive_color_scheme=dark"
    );
    expect(html).toContain("hive-opencode-embed.css?hive_proxy=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
