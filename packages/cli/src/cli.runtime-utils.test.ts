/// <reference types="vitest" />
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  extractPortFromUrl,
  findListeningProcessId,
  installCompletionScript,
  isHiveHealthResponse,
  waitForServerReady,
} from "./runtime-utils";

const HIVE_PORT = 3000;
const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;
const UNIX_HIVE_PID = 401_148;
const WINDOWS_HIVE_PID = 8124;
const API_LISTENING_PATTERN = /API listening on /;

describe("waitForServerReady", () => {
  it("resolves when the healthcheck responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: fetchMock,
      timeoutMs: 50,
      intervalMs: 5,
    });

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns false once the timeout elapses", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unreachable"));

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: fetchMock,
      timeoutMs: 20,
      intervalMs: 5,
    });

    expect(ready).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("waits for a Hive-shaped health response when a validator is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ service: "hive", status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: fetchMock,
      intervalMs: 5,
      timeoutMs: 50,
      isReadyResponse: async (response) =>
        isHiveHealthResponse(await response.json()),
    });

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries equivalent loopback hosts before timing out", async () => {
    const fetchMock = vi.fn((requestUrl: string) => {
      if (requestUrl === "http://[::1]:3000/health") {
        return Promise.resolve(
          new Response(JSON.stringify({ service: "hive", status: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }

      return Promise.reject(new Error("unreachable"));
    });

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: fetchMock,
      intervalMs: 5,
      timeoutMs: 50,
      isReadyResponse: async (response) =>
        isHiveHealthResponse(await response.json()),
    });

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/health",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/health",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://[::1]:3000/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("accepts a daemon readiness log line even before health responds", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-log-"));
    const logPath = join(tempDir, "hive.log");
    const fetchMock = vi.fn().mockRejectedValue(new Error("unreachable"));

    setTimeout(() => {
      writeFileSync(
        logPath,
        "API listening on http://localhost:3000\n",
        "utf8"
      );
    }, 10);

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: fetchMock,
      intervalMs: 5,
      timeoutMs: 50,
      readyLogFilePath: logPath,
      readyLogInitialOffset: 0,
      readyLogPattern: API_LISTENING_PATTERN,
    });

    expect(ready).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("ignores stale readiness lines before the launch offset", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-log-"));
    const logPath = join(tempDir, "hive.log");
    writeFileSync(logPath, "API listening on http://localhost:3000\n", "utf8");

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: vi.fn().mockRejectedValue(new Error("unreachable")),
      intervalMs: 5,
      timeoutMs: 20,
      readyLogFilePath: logPath,
      readyLogInitialOffset: readFileSync(logPath, "utf8").length,
      readyLogPattern: API_LISTENING_PATTERN,
    });

    expect(ready).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts a ready file that matches the launched pid", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-ready-"));
    const readyFilePath = join(tempDir, "daemon-ready");

    setTimeout(() => {
      writeFileSync(readyFilePath, "1234\n", "utf8");
    }, 10);

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: vi.fn().mockRejectedValue(new Error("unreachable")),
      intervalMs: 5,
      timeoutMs: 50,
      readyFilePath,
      readyFileContents: "1234",
    });

    expect(ready).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("ignores a ready file with the wrong pid", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-ready-"));
    const readyFilePath = join(tempDir, "daemon-ready");
    writeFileSync(readyFilePath, "9999\n", "utf8");

    const ready = await waitForServerReady({
      url: "http://localhost:3000/health",
      fetchImpl: vi.fn().mockRejectedValue(new Error("unreachable")),
      intervalMs: 5,
      timeoutMs: 20,
      readyFilePath,
      readyFileContents: "1234",
    });

    expect(ready).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("installCompletionScript", () => {
  it("writes the script with a trailing newline", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-"));
    const targetPath = join(tempDir, "_hive_test");

    const result = installCompletionScript("test-script", targetPath);

    const content = readFileSync(targetPath, "utf8");
    expect(result.ok).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("isHiveHealthResponse", () => {
  it("recognizes the Hive health payload", () => {
    expect(isHiveHealthResponse({ service: "hive", status: "ok" })).toBe(true);
    expect(isHiveHealthResponse({ status: "error" })).toBe(false);
    expect(isHiveHealthResponse({ status: "ok" })).toBe(false);
    expect(isHiveHealthResponse(null)).toBe(false);
  });
});

describe("extractPortFromUrl", () => {
  it("returns explicit ports", () => {
    expect(extractPortFromUrl("http://localhost:3000/health")).toBe(HIVE_PORT);
  });

  it("falls back to protocol defaults", () => {
    expect(extractPortFromUrl("http://localhost/health")).toBe(
      HTTP_DEFAULT_PORT
    );
    expect(extractPortFromUrl("https://localhost/health")).toBe(
      HTTPS_DEFAULT_PORT
    );
  });

  it("returns null for invalid URLs", () => {
    expect(extractPortFromUrl("not-a-url")).toBeNull();
  });
});

describe("findListeningProcessId", () => {
  it("parses lsof output on unix-like platforms", () => {
    const runCommand = vi.fn().mockReturnValue({
      status: 0,
      stdout: "401148\n",
    });

    expect(
      findListeningProcessId({
        port: HIVE_PORT,
        platform: "linux",
        runCommand,
      })
    ).toBe(UNIX_HIVE_PID);
  });

  it("falls back to ss output when lsof is unavailable", () => {
    const runCommand = vi.fn((command: string) => {
      if (command === "lsof") {
        return { status: 1, stdout: "" };
      }

      return {
        status: 0,
        stdout:
          'LISTEN 0      511        127.0.0.1:3000      0.0.0.0:*    users:(("hive",pid=401148,fd=27))',
      };
    });

    expect(
      findListeningProcessId({
        port: HIVE_PORT,
        platform: "linux",
        runCommand,
      })
    ).toBe(UNIX_HIVE_PID);
  });

  it("parses netstat output on windows", () => {
    const runCommand = vi.fn().mockReturnValue({
      status: 0,
      stdout: [
        "  Proto  Local Address          Foreign Address        State           PID",
        "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       8124",
      ].join("\n"),
    });

    expect(
      findListeningProcessId({
        port: HIVE_PORT,
        platform: "win32",
        runCommand,
      })
    ).toBe(WINDOWS_HIVE_PID);
  });

  it("returns null when no matching listener is found", () => {
    const runCommand = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
    });

    expect(
      findListeningProcessId({
        port: HIVE_PORT,
        platform: "linux",
        runCommand,
      })
    ).toBeNull();
  });
});
