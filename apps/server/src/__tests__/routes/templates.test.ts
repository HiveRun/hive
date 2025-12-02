import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as OpencodeConfig from "../../agents/opencode-config";
import {
  type HiveConfigError,
  HiveConfigService,
  type HiveConfigService as HiveConfigServiceType,
} from "../../config/context";
import type { HiveConfig } from "../../config/schema";
import { templatesRoutes } from "../../routes/templates";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as Runtime from "../../runtime";
import type { WorkspaceRuntimeContext } from "../../workspaces/context";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as WorkspaceContext from "../../workspaces/context";
import { WorkspaceContextError } from "../../workspaces/context";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const workspacePath = "/tmp/workspace";

const baseHiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "opencode/model",
  },
  promptSources: [],
  templates: {
    "template-basic": {
      id: "template-basic",
      label: "Basic",
      type: "manual",
    },
  },
  defaults: {
    templateId: "template-basic",
  },
};

let runServerEffectSpy: any;
let workspaceContextEffectSpy: any;
let loadOpencodeConfigSpy: any;

const provideHiveConfig = (service: HiveConfigServiceType) =>
  runServerEffectSpy.mockImplementation(
    (effect: Parameters<typeof Runtime.runServerEffect>[0]) =>
      Effect.runPromise(
        Effect.provideService(effect as any, HiveConfigService, service) as any
      )
  );

const createSuccessfulHiveConfigService = (
  config: HiveConfig
): HiveConfigServiceType => ({
  workspaceRoot: workspacePath,
  resolve: () => workspacePath,
  load: () => Effect.succeed(config),
  clear: () => Effect.void,
});

const createFailingHiveConfigService = (
  message: string
): HiveConfigServiceType => ({
  workspaceRoot: workspacePath,
  resolve: () => workspacePath,
  load: () =>
    Effect.fail<HiveConfigError>({
      _tag: "HiveConfigError",
      workspaceRoot: workspacePath,
      cause: new Error(message),
    }),
  clear: () => Effect.void,
});

const createWorkspaceContext = (
  path = workspacePath
): WorkspaceRuntimeContext =>
  ({
    workspace: {
      id: "workspace-basic",
      label: "Workspace",
      path,
      addedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    },
    loadConfig: async () => baseHiveConfig,
    createWorktreeManager: async () => ({}),
    createWorktree: async () => ({
      path: `${path}/.hive/cells/sample`,
      branch: "main",
      baseCommit: "abc",
    }),
    removeWorktree: async () => {
      /* noop in tests */
    },
  }) as unknown as WorkspaceRuntimeContext;

const createApp = () => new Elysia().use(templatesRoutes);

describe("templatesRoutes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runServerEffectSpy = vi.spyOn(Runtime, "runServerEffect");
    provideHiveConfig(createSuccessfulHiveConfigService(baseHiveConfig));
    workspaceContextEffectSpy = vi
      .spyOn(WorkspaceContext, "resolveWorkspaceContextEffect")
      .mockReturnValue(Effect.succeed(createWorkspaceContext()));
    loadOpencodeConfigSpy = vi
      .spyOn(OpencodeConfig, "loadOpencodeConfig")
      .mockResolvedValue({ config: {}, source: "workspace" });
  });

  it("returns the templates list for a workspace", async () => {
    const agentDefaults = { providerId: "anthropic", modelId: "claude-3" };
    loadOpencodeConfigSpy.mockResolvedValue({
      config: {},
      source: "workspace",
      defaultModel: agentDefaults,
    });

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates?workspaceId=w-123")
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      templates: Array<{ id: string }>;
      defaults: Record<string, string>;
      agentDefaults?: typeof agentDefaults;
    };
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0]?.id).toBe("template-basic");
    expect(payload.defaults).toEqual(baseHiveConfig.defaults);
    expect(payload.agentDefaults).toEqual(agentDefaults);
    expect(workspaceContextEffectSpy).toHaveBeenCalledWith("w-123");
  });

  it("returns a template by id", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request(
        "http://localhost/api/templates/template-basic?workspaceId=workspace-basic"
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as { id: string; label: string };
    expect(payload.id).toBe("template-basic");
    expect(payload.label).toBe("Basic");
  });

  it("returns 404 when template is missing", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request(
        "http://localhost/api/templates/missing-template?workspaceId=w-123"
      )
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("Template 'missing-template' not found");
  });

  it("returns 400 when workspace cannot be resolved", async () => {
    workspaceContextEffectSpy.mockReturnValueOnce(
      Effect.fail(new WorkspaceContextError("No workspace"))
    );

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("workspace");
  });

  it("returns 400 when hive config loading fails", async () => {
    provideHiveConfig(createFailingHiveConfigService("load error"));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates?workspaceId=w-123")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("Failed to load workspace config");
  });

  it("returns 400 when OpenCode config cannot be read", async () => {
    loadOpencodeConfigSpy.mockRejectedValue(new Error("opencode missing"));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates?workspaceId=w-123")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("OpenCode");
  });
});
