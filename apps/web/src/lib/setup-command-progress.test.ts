import { describe, expect, it } from "vitest";
import { buildSetupCommandProgress } from "./setup-command-progress";

describe("buildSetupCommandProgress", () => {
  it("marks commands progressively from setup log markers", () => {
    const progress = buildSetupCommandProgress({
      cellStatus: "provisioning",
      commands: ["bun install", "bun run dev"],
      setupLog: [
        "[setup] Starting template setup for hive-dev",
        "[setup] Running: bun install",
        "[setup] Completed: bun install",
        "[setup] Running: bun run dev",
      ].join("\n"),
    });

    expect(progress).toEqual([
      { command: "bun install", state: "done" },
      { command: "bun run dev", state: "running" },
    ]);
  });

  it("keeps only the latest setup run when retries append more output", () => {
    const progress = buildSetupCommandProgress({
      cellStatus: "provisioning",
      commands: ["first", "second"],
      setupLog: [
        "[setup] Starting template setup for retry-1",
        "[setup] Running: first",
        "[setup] Failed: first (exit 1)",
        "[setup] Starting template setup for retry-2",
        "[setup] Running: first",
        "[setup] Completed: first",
      ].join("\n"),
    });

    expect(progress).toEqual([
      { command: "first", state: "done" },
      { command: "second", state: "pending" },
    ]);
  });

  it("marks failed commands as error", () => {
    const progress = buildSetupCommandProgress({
      cellStatus: "error",
      commands: ["bun install", "bun run build"],
      setupLog: [
        "[setup] Starting template setup for hive-dev",
        "[setup] Running: bun install",
        "[setup] Completed: bun install",
        "[setup] Running: bun run build",
        "[setup] Failed: bun run build (exit 1)",
      ].join("\n"),
    });

    expect(progress).toEqual([
      { command: "bun install", state: "done" },
      { command: "bun run build", state: "error" },
    ]);
  });

  it("reconciles a trailing running step against terminal lag on error", () => {
    const progress = buildSetupCommandProgress({
      cellStatus: "error",
      commands: ["bun install"],
      setupLog: [
        "[setup] Starting template setup for hive-dev",
        "[setup] Running: bun install",
      ].join("\n"),
    });

    expect(progress).toEqual([{ command: "bun install", state: "error" }]);
  });

  it("reconciles a trailing running step against terminal lag on ready", () => {
    const progress = buildSetupCommandProgress({
      cellStatus: "ready",
      commands: ["bun install"],
      setupLog: [
        "[setup] Starting template setup for hive-dev",
        "[setup] Running: bun install",
      ].join("\n"),
    });

    expect(progress).toEqual([{ command: "bun install", state: "done" }]);
  });
});
