/// <reference types="vitest" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  installCompletionScriptEffect,
  waitForServerReadyEffect,
} from "./effects";

describe("waitForServerReadyEffect", () => {
  it("resolves when the healthcheck responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);

    const ready = await Effect.runPromise(
      waitForServerReadyEffect({
        url: "http://localhost:3000/health",
        fetchImpl: fetchMock,
        timeoutMs: 50,
        intervalMs: 5,
      })
    );

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns false once the timeout elapses", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unreachable"));

    const ready = await Effect.runPromise(
      waitForServerReadyEffect({
        url: "http://localhost:3000/health",
        fetchImpl: fetchMock,
        timeoutMs: 20,
        intervalMs: 5,
      })
    );

    expect(ready).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("installCompletionScriptEffect", () => {
  it("writes the script with a trailing newline", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hive-cli-"));
    const targetPath = join(tempDir, "_hive_test");

    const result = await Effect.runPromise(
      installCompletionScriptEffect("zsh", targetPath)
    );

    const content = readFileSync(targetPath, "utf8");
    expect(result.ok).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
