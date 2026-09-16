import { describe, expect, it, vi } from "vitest";
import { runGracefulShutdown } from "./shutdown";

function createDependencies() {
  return {
    clearOpencodeConnection: vi.fn(() => Promise.resolve()),
    closeAgentSessions: vi.fn(() => Promise.resolve()),
    prepareAgentSessions: vi.fn(() => Promise.resolve()),
    stopCellServices: vi.fn(() => Promise.resolve()),
    stopCellTerminals: vi.fn(() => Promise.resolve()),
    stopChatTerminals: vi.fn(() => Promise.resolve()),
  };
}

describe("graceful shutdown", () => {
  it("does not tear down cell resources when agent interruption fails", async () => {
    const dependencies = createDependencies();
    dependencies.prepareAgentSessions.mockRejectedValue(
      new Error("interrupt failed")
    );

    await expect(runGracefulShutdown(dependencies)).rejects.toThrow(
      "interrupt failed"
    );

    expect(dependencies.prepareAgentSessions).toHaveBeenCalledOnce();
    expect(dependencies.stopCellServices).not.toHaveBeenCalled();
    expect(dependencies.stopChatTerminals).not.toHaveBeenCalled();
    expect(dependencies.stopCellTerminals).not.toHaveBeenCalled();
  });

  it("continues post-interrupt cleanup and reports every failure", async () => {
    const dependencies = createDependencies();
    dependencies.closeAgentSessions.mockRejectedValue(
      new Error("agent cleanup failed")
    );
    dependencies.stopChatTerminals.mockRejectedValue(
      new Error("chat cleanup failed")
    );

    await expect(runGracefulShutdown(dependencies)).rejects.toThrow(
      "Hive shutdown cleanup failed"
    );

    expect(dependencies.stopCellServices).toHaveBeenCalledOnce();
    expect(dependencies.stopCellTerminals).toHaveBeenCalledOnce();
    expect(dependencies.clearOpencodeConnection).toHaveBeenCalledOnce();
  });
});
