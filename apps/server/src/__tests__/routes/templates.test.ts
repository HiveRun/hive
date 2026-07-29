import type { Stats } from "node:fs";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as FsPromises from "node:fs/promises";
import { Elysia } from "elysia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

type TemplateListTestPayload = {
  defaults: Record<string, string>;
  agentDefaults?: unknown;
  templates: Array<{ id: string }>;
};

let getWorkspaceRegistrySpy: any;
let loadConfigSpy: any;
let loadEffectiveOpencodeDefaultsSpy: any;
let statSpy: any;

const createApp = () => new Elysia().use(templatesRoutes);

const templateRequest = (path = "/api/templates?workspaceId=workspace-basic") =>
  createApp().handle(new Request(`http://localhost${path}`));

const parseMessage = async (response: Response) =>
  (await response.json()) as { message: string };

const parseTemplateList = async (response: Response) =>
  (await response.json()) as TemplateListTestPayload;

const readTemplateFailure = async () => {
  const response = await templateRequest();
  return { response, payload: await parseMessage(response) };
};

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

    loadEffectiveOpencodeDefaultsSpy = vi
      .spyOn(OpencodeConfig, "loadEffectiveOpencodeDefaults")
      .mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the templates list for a workspace", async () => {
    const agentDefaults = {
      providerId: "anthropic",
      modelId: "claude-3",
      variant: "high",
    };
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: agentDefaults,
    });

    const response = await templateRequest();

    const payload = await parseTemplateList(response);
    expect({
      status: response.status,
      templateCount: payload.templates.length,
      firstTemplateId: payload.templates[0]?.id,
      defaults: payload.defaults,
      agentDefaults: payload.agentDefaults,
    }).toEqual({
      status: HTTP_OK,
      templateCount: 1,
      firstTemplateId: "template-basic",
      defaults: {
        ...baseHiveConfig.defaults,
        startMode: "plan",
      },
      agentDefaults,
    });
    expect(getWorkspaceRegistrySpy).toHaveBeenCalled();
    expect(loadConfigSpy).toHaveBeenCalledWith(workspacePath);
  });

  it("returns a template by id", async () => {
    const response = await templateRequest(
      "/api/templates/template-basic?workspaceId=workspace-basic"
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as { id: string; label: string };
    expect(payload.id).toBe("template-basic");
    expect(payload.label).toBe("Basic");
  });

  it("returns 404 when template is missing", async () => {
    const response = await templateRequest(
      "/api/templates/missing-template?workspaceId=workspace-basic"
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = await parseMessage(response);
    expect(payload.message).toContain("Template 'missing-template' not found");
  });

  it("returns 400 when workspace cannot be resolved", async () => {
    getWorkspaceRegistrySpy.mockResolvedValueOnce({
      workspaces: [workspaceRecord],
      activeWorkspaceId: workspaceRecord.id,
    });

    const response = await templateRequest(
      "/api/templates?workspaceId=missing-workspace"
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = await parseMessage(response);
    expect(payload.message).toContain(
      "Workspace 'missing-workspace' not found"
    );
  });

  it("returns 400 when hive config loading fails", async () => {
    loadConfigSpy.mockRejectedValueOnce(new Error("load error"));

    const { response, payload } = await readTemplateFailure();

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(payload.message).toContain("Failed to load workspace config");
  });

  it("falls back to Hive defaults when OpenCode defaults cannot be read", async () => {
    loadEffectiveOpencodeDefaultsSpy.mockRejectedValue(
      new Error("opencode missing")
    );

    const response = await templateRequest();

    const payload = await parseTemplateList(response);
    expect({
      status: response.status,
      listedTemplateIds: payload.templates.map((template) => template.id),
      defaults: payload.defaults,
      hasAgentDefaults: "agentDefaults" in payload,
    }).toEqual({
      status: HTTP_OK,
      listedTemplateIds: ["template-basic"],
      defaults: {
        ...baseHiveConfig.defaults,
        startMode: "plan",
      },
      hasAgentDefaults: false,
    });
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
