import { afterEach, describe, expect, it, vi } from "vitest";

const sdkMocks = {
  close: vi.fn(() => Promise.resolve()),
  createOpencodeClient: vi.fn((options: { baseUrl: string }) => options),
  createOpencodeServer: vi.fn(),
};

vi.mock("@opencode-ai/sdk", () => ({
  createOpencodeClient: sdkMocks.createOpencodeClient,
  createOpencodeServer: sdkMocks.createOpencodeServer,
}));

const GLOBAL_STATE_KEY = "__hiveSharedOpencodeServerState";

function clearGlobalState() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_STATE_KEY];
}

afterEach(async () => {
  const { stopSharedOpencodeServer } = await import(
    "../../agents/opencode-server"
  );
  await stopSharedOpencodeServer();
  clearGlobalState();
  vi.clearAllMocks();
});

describe("shared OpenCode server", () => {
  it("uses the reserved port and survives module reloads", async () => {
    sdkMocks.createOpencodeServer.mockResolvedValue({
      url: "http://127.0.0.1:43123",
      close: sdkMocks.close,
    });
    const config = { config: {}, source: "default" as const };
    const firstModule = await import("../../agents/opencode-server");

    await firstModule.startSharedOpencodeServer(config, { port: 43_123 });
    const moduleUrl = new URL(
      "../../agents/opencode-server.ts?reload=1",
      import.meta.url
    ).href;
    const reloadedModule = (await import(moduleUrl)) as typeof firstModule;
    await reloadedModule.startSharedOpencodeServer(config, { port: 45_678 });

    expect(sdkMocks.createOpencodeServer).toHaveBeenCalledOnce();
    expect(sdkMocks.createOpencodeServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 43_123 })
    );
    expect(reloadedModule.getSharedOpencodeServerBaseUrl()).toBe(
      "http://127.0.0.1:43123"
    );
  });
});
