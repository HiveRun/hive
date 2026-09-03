import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = {
  healthGet: vi.fn(() =>
    Promise.resolve({
      healthy: true as const,
      version: "0.0.0-beta-18866",
      pid: 123,
    })
  ),
  migrationStatus: vi.fn((_options?: { signal?: AbortSignal }) =>
    Promise.resolve({ status: "completed" as const })
  ),
  make: vi.fn(),
};

const serviceMocks = {
  discover: vi.fn<() => Promise<{ url: string } | undefined>>(() =>
    Promise.resolve(undefined)
  ),
  ensure: vi.fn(() =>
    Promise.resolve({
      url: "http://127.0.0.1:43123",
      auth: {
        type: "basic" as const,
        username: "opencode",
        password: "secret",
      },
    })
  ),
  headers: vi.fn(() => ({ authorization: "Basic token" })),
  stop: vi.fn(() => Promise.resolve()),
};

vi.mock("@opencode-ai/client", () => ({
  OpenCode: { make: clientMocks.make },
}));

vi.mock("@opencode-ai/client/service", () => ({
  Service: serviceMocks,
}));

vi.mock("../../agents/opencode-binary", () => ({
  OPENCODE_VERSION: "0.0.0-beta-18866",
  resolveOpencodeBinary: () => "/opt/hive/opencode2",
}));

const originalMigrationTimeout = process.env.HIVE_OPENCODE_MIGRATION_TIMEOUT_MS;

function createCurrentClient(healthGet = clientMocks.healthGet) {
  return {
    health: { get: healthGet },
    migration: { v1: { status: clientMocks.migrationStatus } },
  };
}

beforeEach(async () => {
  const { clearSharedOpencodeServerConnection } = await import(
    "../../agents/opencode-server"
  );
  await clearSharedOpencodeServerConnection();
});

afterEach(async () => {
  const { clearSharedOpencodeServerConnection } = await import(
    "../../agents/opencode-server"
  );
  await clearSharedOpencodeServerConnection();
  if (originalMigrationTimeout === undefined) {
    process.env.HIVE_OPENCODE_MIGRATION_TIMEOUT_MS = undefined;
  } else {
    process.env.HIVE_OPENCODE_MIGRATION_TIMEOUT_MS = originalMigrationTimeout;
  }
  vi.clearAllMocks();
});

describe("shared OpenCode service", () => {
  it("ensures the exact service version and survives module reloads", async () => {
    const client = createCurrentClient();
    clientMocks.make.mockReturnValue(client);
    const firstModule = await import("../../agents/opencode-server");

    await firstModule.startSharedOpencodeServer();
    const moduleUrl = new URL(
      "../../agents/opencode-server.ts?reload=1",
      import.meta.url
    ).href;
    const reloadedModule = (await import(moduleUrl)) as typeof firstModule;
    await reloadedModule.startSharedOpencodeServer();

    expect(serviceMocks.ensure).toHaveBeenCalledOnce();
    expect(serviceMocks.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "0.0.0-beta-18866",
        command: ["/opt/hive/opencode2", "serve", "--service"],
        env: {
          OPENCODE_CLIENT: "hive",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
        },
      })
    );
    expect(clientMocks.make).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:43123",
      headers: { authorization: "Basic token" },
    });
    expect(reloadedModule.getSharedOpencodeServerBaseUrl()).toBe(
      "http://127.0.0.1:43123"
    );
  });

  it("prepares Hive sessions before replacing another service version", async () => {
    const oldClient = {
      health: {
        get: vi.fn(() =>
          Promise.resolve({ healthy: true, version: "1.4.3", pid: 122 })
        ),
      },
    };
    const currentClient = createCurrentClient();
    clientMocks.make
      .mockReturnValueOnce(oldClient)
      .mockReturnValueOnce(currentClient);
    serviceMocks.discover.mockResolvedValueOnce({
      url: "http://127.0.0.1:4000",
    });
    const beforeReplace = vi.fn(() => Promise.resolve());
    const { startSharedOpencodeServer } = await import(
      "../../agents/opencode-server"
    );

    await startSharedOpencodeServer({ beforeReplace });

    expect(beforeReplace).toHaveBeenCalledWith(oldClient);
    expect(beforeReplace.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.ensure.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY
    );
  });

  it("clears Hive's connection without stopping the shared user service", async () => {
    clientMocks.make.mockReturnValue(createCurrentClient());
    const {
      clearSharedOpencodeServerConnection,
      getSharedOpencodeServerBaseUrl,
      startSharedOpencodeServer,
    } = await import("../../agents/opencode-server");

    await startSharedOpencodeServer();
    await clearSharedOpencodeServerConnection();

    expect(getSharedOpencodeServerBaseUrl()).toBeNull();
    expect(serviceMocks.stop).not.toHaveBeenCalled();
  });

  it("reacquires the exact service after a cached client becomes stale", async () => {
    const firstHealth = vi
      .fn()
      .mockResolvedValueOnce({
        healthy: true as const,
        version: "0.0.0-beta-18866",
        pid: 123,
      })
      .mockRejectedValueOnce(new Error("service stopped"));
    const firstClient = createCurrentClient(firstHealth);
    const replacementClient = createCurrentClient();
    clientMocks.make
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(replacementClient);
    const { acquireSharedOpencodeClient, startSharedOpencodeServer } =
      await import("../../agents/opencode-server");

    await startSharedOpencodeServer();
    const acquired = await acquireSharedOpencodeClient();

    expect(acquired).toBe(replacementClient);
    expect(serviceMocks.ensure).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled v1 migration status requests", async () => {
    process.env.HIVE_OPENCODE_MIGRATION_TIMEOUT_MS = "20";
    clientMocks.migrationStatus.mockImplementationOnce(
      (options?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true }
          );
        })
    );
    clientMocks.make.mockReturnValue(createCurrentClient());
    const { startSharedOpencodeServer } = await import(
      "../../agents/opencode-server"
    );

    await expect(startSharedOpencodeServer()).rejects.toThrow(
      "Timed out after 20ms waiting for OpenCode v1 migration"
    );
  });
});
