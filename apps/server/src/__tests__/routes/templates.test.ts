import type { Stats } from "node:fs";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as FsPromises from "node:fs/promises";
import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as OpencodeConfig from "../../agents/opencode-config";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as Loader from "../../config/loader";
import type { HiveConfig } from "../../config/schema";
import { templatesRoutes } from "../../routes/templates";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as WorkspaceRegistry from "../../workspaces/registry";

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

const workspaceRecord: WorkspaceRegistry.WorkspaceRecord = {
  id: "workspace-basic",
  label: "Workspace",
  path: workspacePath,
  addedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
};

let getWorkspaceRegistrySpy: any;
let loadConfigSpy: any;
let loadOpencodeConfigSpy: any;
let statSpy: any;

const createApp = () => new Elysia().use(templatesRoutes);

describe("templatesRoutes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    getWorkspaceRegistrySpy = vi
      .spyOn(WorkspaceRegistry, "getWorkspaceRegistry")
      .mockResolvedValue({
        workspaces: [workspaceRecord],
        activeWorkspaceId: workspaceRecord.id,
      });

    loadConfigSpy = vi
      .spyOn(Loader, "loadConfig")
      .mockResolvedValue(baseHiveConfig);

    statSpy = vi
      .spyOn(FsPromises, "stat")
      .mockResolvedValue({ mtimeMs: 1000 } as Stats);

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
      new Request("http://localhost/api/templates?workspaceId=workspace-basic")
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
    expect(getWorkspaceRegistrySpy).toHaveBeenCalled();
    expect(loadConfigSpy).toHaveBeenCalledWith(workspacePath);
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
        "http://localhost/api/templates/missing-template?workspaceId=workspace-basic"
      )
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("Template 'missing-template' not found");
  });

  it("returns 400 when workspace cannot be resolved", async () => {
    getWorkspaceRegistrySpy.mockResolvedValueOnce({
      workspaces: [workspaceRecord],
      activeWorkspaceId: workspaceRecord.id,
    });

    const app = createApp();
    const response = await app.handle(
      new Request(
        "http://localhost/api/templates?workspaceId=missing-workspace"
      )
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain(
      "Workspace 'missing-workspace' not found"
    );
  });

  it("returns 400 when hive config loading fails", async () => {
    loadConfigSpy.mockRejectedValueOnce(new Error("load error"));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates?workspaceId=workspace-basic")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("Failed to load workspace config");
  });

  it("returns 400 when OpenCode config cannot be read", async () => {
    loadOpencodeConfigSpy.mockRejectedValue(new Error("opencode missing"));

    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/templates?workspaceId=workspace-basic")
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("OpenCode");
  });

  it("refreshes cached template config when hive config mtime changes", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const updatedConfig: HiveConfig = {
      ...baseHiveConfig,
      templates: {
        ...baseHiveConfig.templates,
        "template-updated": {
          id: "template-updated",
          label: "Updated",
          type: "manual",
        },
      },
      defaults: {
        templateId: "template-updated",
      },
    };

    loadConfigSpy
      .mockResolvedValueOnce(baseHiveConfig)
      .mockResolvedValueOnce(updatedConfig);
    statSpy
      .mockResolvedValueOnce({ mtimeMs: 1000 } as Stats)
      .mockResolvedValueOnce({ mtimeMs: 2000 } as Stats);

    try {
      const app = createApp();
      const url = "http://localhost/api/templates?workspaceId=workspace-basic";

      const first = await app.handle(new Request(url));
      expect(first.status).toBe(HTTP_OK);
      const firstPayload = (await first.json()) as {
        defaults: { templateId?: string };
      };
      expect(firstPayload.defaults.templateId).toBe("template-basic");

      const second = await app.handle(new Request(url));
      expect(second.status).toBe(HTTP_OK);
      const secondPayload = (await second.json()) as {
        defaults: { templateId?: string };
        templates: Array<{ id: string }>;
      };
      expect(secondPayload.defaults.templateId).toBe("template-updated");
      expect(
        secondPayload.templates.some(
          (template) => template.id === "template-updated"
        )
      ).toBe(true);
      expect(loadConfigSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
