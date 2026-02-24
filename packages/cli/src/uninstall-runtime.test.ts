/// <reference types="vitest" />

import { describe, expect, it, vi } from "vitest";

import {
  FOREGROUND_DAEMON_ERROR,
  resolveUninstallStopResult,
} from "./uninstall-runtime";

const createLogger = () => vi.fn<(message: string) => void>();

const baseOptions = () => ({
  healthcheckUrl: "http://localhost:3000/health",
  logInfo: createLogger(),
  logError: createLogger(),
});

describe("resolveUninstallStopResult", () => {
  it("does not stop or probe when uninstall is not confirmed", async () => {
    const stopBackgroundProcess = vi.fn(() => "stopped" as const);
    const probeJson = vi.fn(async () => ({ status: "ok" }));

    const result = await resolveUninstallStopResult({
      confirmed: false,
      stopBackgroundProcess,
      probeJson,
      ...baseOptions(),
    });

    expect(result).toBe("not_running");
    expect(stopBackgroundProcess).not.toHaveBeenCalled();
    expect(probeJson).not.toHaveBeenCalled();
  });

  it("returns failed when stop process fails", async () => {
    const stopBackgroundProcess = vi.fn(() => "failed" as const);
    const probeJson = vi.fn(async () => null);

    const result = await resolveUninstallStopResult({
      confirmed: true,
      stopBackgroundProcess,
      probeJson,
      ...baseOptions(),
    });

    expect(result).toBe("failed");
    expect(probeJson).not.toHaveBeenCalled();
  });

  it("returns failed when health response looks like Hive", async () => {
    const stopBackgroundProcess = vi.fn(() => "not_running" as const);
    const probeJson = vi.fn(async () => ({ status: "ok" }));
    const options = baseOptions();

    const result = await resolveUninstallStopResult({
      confirmed: true,
      stopBackgroundProcess,
      probeJson,
      ...options,
    });

    expect(result).toBe("failed");
    expect(options.logError).toHaveBeenCalledWith(FOREGROUND_DAEMON_ERROR);
  });

  it("does not fail when /health response is not Hive-shaped", async () => {
    const stopBackgroundProcess = vi.fn(() => "not_running" as const);
    const probeJson = vi.fn(async () => ({ ok: true }));

    const result = await resolveUninstallStopResult({
      confirmed: true,
      stopBackgroundProcess,
      probeJson,
      ...baseOptions(),
    });

    expect(result).toBe("not_running");
  });

  it("logs stale pid cleanup when stale pid is detected", async () => {
    const stopBackgroundProcess = vi.fn(() => "stale_pid" as const);
    const probeJson = vi.fn(async () => null);
    const options = baseOptions();

    const result = await resolveUninstallStopResult({
      confirmed: true,
      stopBackgroundProcess,
      probeJson,
      ...options,
    });

    expect(result).toBe("not_running");
    expect(options.logInfo).toHaveBeenCalledWith("Removed stale PID file.");
  });
});
