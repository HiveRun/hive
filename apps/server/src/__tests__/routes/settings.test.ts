import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HiveConfigService,
  type HiveConfigService as HiveConfigServiceType,
} from "../../config/context";
import type { HiveConfig } from "../../config/schema";
import { settingsRoutes } from "../../routes/settings";
import {
  WorkspaceContextError,
  type WorkspaceRuntimeContext,
} from "../../workspaces/context";
import type { WorktreeManager } from "../../worktree/manager";

type RunServerEffect = typeof import("../../runtime").runServerEffect;

const HTTP_OK = 200;

const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE_ENTITY = 422;
const HTTP_INTERNAL_ERROR = 500;
const workspacePath = "/tmp/workspace";

const baseConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "opencode/model",
  },
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    basic: {
      id: "basic",
      label: "Basic",
      type: "manual",
      includePatterns: [".env*"],
    },
  },
  defaults: {
    templateId: "basic",
  },
};

let runServerEffectSpy: any;
let workspaceContextEffectSpy: any;
let writeHiveConfigSpy: any;

const provideHiveConfig = (service: HiveConfigServiceType) => {
  runServerEffectSpy.mockImplementation(
    (effect: Parameters<RunServerEffect>[0]) =>
      Effect.runPromise(
        Effect.provideService(effect as any, HiveConfigService, service) as any
      )
  );
};

const createHiveConfigService = (
  config: HiveConfig,
  clearMock = vi.fn()
): HiveConfigServiceType => ({
  workspaceRoot: workspacePath,
  resolve: () => workspacePath,
  load: () => Effect.succeed(config),
  clear: () => Effect.sync(() => clearMock()),
});

const createWorkspaceContext = (
  path = workspacePath,
  config: HiveConfig = baseConfig
): WorkspaceRuntimeContext => {
  const manager: WorktreeManager = {
    createWorktree: () => Effect.never,
    removeWorktree: () => Effect.void,
  };

  return {
    workspace: {
      id: "workspace-basic",
      label: "Workspace",
      path,
      addedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    },
    loadConfig: () => Effect.succeed(config),
    createWorktreeManager: () => Effect.succeed(manager),
    createWorktree: () => Effect.never,
    removeWorktree: () => Effect.void,
  } as WorkspaceRuntimeContext;
};

const createApp = () => new Elysia().use(settingsRoutes);

describe("settingsRoutes", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();

    const runtimeModule = await import("../../runtime");
    runServerEffectSpy = vi.spyOn(runtimeModule, "runServerEffect");

    const writerModule = await import("../../config/writer");
    writeHiveConfigSpy = vi
      .spyOn(writerModule, "writeHiveConfigFile")
      .mockResolvedValue(`${workspacePath}/hive.config.ts`);

    const workspaceModule = await import("../../workspaces/context");
    workspaceContextEffectSpy = vi
      .spyOn(workspaceModule, "resolveWorkspaceContextEffect")
      .mockReturnValue(Effect.succeed(createWorkspaceContext()));

    provideHiveConfig(createHiveConfigService(baseConfig));
  });

  it("returns the current hive config for a workspace", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/settings/hive?workspaceId=w-123")
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      config: HiveConfig;
      workspaceId: string;
      configPath: string;
      schema: Record<string, unknown>;
    };
    expect(payload.workspaceId).toBe("workspace-basic");
    expect(payload.config.templates.basic?.id).toBe("basic");
    expect(payload.schema).toBeTruthy();
    expect(payload.configPath).toContain("hive.config.ts");
    expect(workspaceContextEffectSpy).toHaveBeenCalledWith("w-123");
  });

  it("returns 400 when workspace resolution fails", async () => {
    workspaceContextEffectSpy.mockReturnValueOnce(
      Effect.fail(new WorkspaceContextError("No active workspace"))
    );

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/settings/hive")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("workspace");
  });

  it("writes updates and clears the hive config cache", async () => {
    const clearMock = vi.fn();
    provideHiveConfig(createHiveConfigService(baseConfig, clearMock));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/settings/hive", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(baseConfig),
      })
    );

    expect(response.status).toBe(HTTP_OK);
    expect(writeHiveConfigSpy).toHaveBeenCalledWith(workspacePath, baseConfig);
    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it("returns validation issues for invalid payloads", async () => {
    const invalidConfig = {
      ...baseConfig,
      opencode: {},
    } as unknown;

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/settings/hive", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(invalidConfig),
      })
    );

    expect(response.status).toBe(HTTP_UNPROCESSABLE_ENTITY);
    const payload = (await response.json()) as {
      message?: string;
      issues?: string[];
    };
    expect(payload.message).toBeTruthy();
  });

  it("surfaces write failures", async () => {
    writeHiveConfigSpy.mockRejectedValueOnce(new Error("disk full"));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/settings/hive", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(baseConfig),
      })
    );

    expect(response.status).toBe(HTTP_INTERNAL_ERROR);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("disk full");
  });
});
