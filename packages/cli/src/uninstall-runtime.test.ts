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

const resolveConfirmedStop = (
  stopBackgroundProcess: () =>
    | "failed"
    | "not_running"
    | "stale_pid"
    | "stopped",
  probeJson: () => Promise<unknown>,
  options = baseOptions()
) =>
  resolveUninstallStopResult({
    confirmed: true,
    stopBackgroundProcess,
    probeJson,
    ...options,
  });

const createStopProbe = (
  stopResult: "failed" | "not_running" | "stale_pid" | "stopped",
  probeResult: unknown
) => ({
  stopBackgroundProcess: vi.fn(() => stopResult),
  probeJson: vi.fn(async () => probeResult),
});

const resolveWithTrackedOptions = async (
  stopResult: "failed" | "not_running" | "stale_pid" | "stopped",
  probeResult: unknown
) => {
  const probe = createStopProbe(stopResult, probeResult);
  const options = baseOptions();
  const result = await resolveConfirmedStop(
    probe.stopBackgroundProcess,
    probe.probeJson,
    options
  );
  return { result, options };
};

describe("resolveUninstallStopResult", () => {
  it("does not stop or probe when uninstall is not confirmed", async () => {
    const stopBackgroundProcess = vi.fn(() => "stopped" as const);
    const probeJson = vi.fn(async () => ({ service: "hive", status: "ok" }));

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
    const { stopBackgroundProcess, probeJson } = createStopProbe(
      "failed",
      null
    );

    const result = await resolveConfirmedStop(stopBackgroundProcess, probeJson);

    expect(result).toBe("failed");
    expect(probeJson).not.toHaveBeenCalled();
  });

  it("returns failed when health response looks like Hive", async () => {
    const { result, options } = await resolveWithTrackedOptions("not_running", {
      service: "hive",
      status: "ok",
    });

    expect(result).toBe("failed");
    expect(options.logError).toHaveBeenCalledWith(FOREGROUND_DAEMON_ERROR);
  });

  it("does not fail when /health response is not Hive-shaped", async () => {
    const { stopBackgroundProcess, probeJson } = createStopProbe(
      "not_running",
      { ok: true }
    );

    const result = await resolveConfirmedStop(stopBackgroundProcess, probeJson);

    expect(result).toBe("not_running");
  });

  it("logs stale pid cleanup when stale pid is detected", async () => {
    const { result, options } = await resolveWithTrackedOptions(
      "stale_pid",
      null
    );

    expect(result).toBe("not_running");
    expect(options.logInfo).toHaveBeenCalledWith("Removed stale PID file.");
  });
});
