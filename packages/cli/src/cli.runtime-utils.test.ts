/// <reference types="vitest" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { installCompletionScript, waitForServerReady } from "./runtime-utils";

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
});

describe("installCompletionScript", () => {
  it("writes the script with a trailing newline", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-"));
    const targetPath = join(tempDir, "_hive_test");

    const result = installCompletionScript("zsh", targetPath);

    const content = readFileSync(targetPath, "utf8");
    expect(result.ok).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
