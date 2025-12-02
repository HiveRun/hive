import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpencodeClient } from "@opencode-ai/sdk";
// biome-ignore lint/performance/noNamespaceImport: tests need namespace import for spies
import * as OpencodeSdk from "@opencode-ai/sdk";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { HiveConfig } from "../config/schema";
import { db } from "../db";
import { cells } from "../schema/cells";
// biome-ignore lint/performance/noNamespaceImport: tests need namespace import for spies
import * as OpencodeConfig from "./opencode-config";

type ClientStub = {
  session: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  };
  event: {
    subscribe: ReturnType<typeof vi.fn>;
  };
  config: {
    providers: ReturnType<typeof vi.fn>;
  };
  postSessionIdPermissionsPermissionId: ReturnType<typeof vi.fn>;
};

const sessionMessagesMock = vi
  .fn()
  .mockResolvedValue({ data: [] as unknown[] });

const mockHiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "template-default",
  },
  promptSources: [],
  templates: {
    "template-basic": {
      id: "template-basic",
      label: "Test Template",
      type: "manual",
      agent: {
        providerId: "opencode",
        modelId: "template-default",
      },
    },
  },
  defaults: {},
};

import {
  closeAllAgentSessions,
  ensureAgentSession,
  resetAgentRuntimeDependencies,
  sendAgentMessage,
  setAgentRuntimeDependencies,
  updateAgentSessionModel,
} from "./service";

describe("agent model selection", () => {
  const cellId = "cell-model-test";
  let clientStub: ClientStub;
  let loadHiveConfigMock: Mock;
  let loadOpencodeConfigSpy: Mock;

  beforeAll(async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const migrationsFolder = join(packageRoot, "src", "migrations");
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await closeAllAgentSessions();
    await db.delete(cells);
    sessionMessagesMock.mockReset();
    sessionMessagesMock.mockResolvedValue({ data: [] });

    clientStub = buildClientStub();
    vi.spyOn(OpencodeSdk, "createOpencodeClient").mockReturnValue(
      clientStub as unknown as OpencodeClient
    );
    vi.spyOn(OpencodeSdk, "createOpencodeServer").mockResolvedValue({
      url: "http://127.0.0.1:0",
      close: vi.fn(),
    });
    loadHiveConfigMock = vi.fn().mockResolvedValue(mockHiveConfig);
    loadOpencodeConfigSpy = vi
      .spyOn(OpencodeConfig, "loadOpencodeConfig")
      .mockResolvedValue({
        config: {},
        source: "default",
      });

    setAgentRuntimeDependencies({
      loadHiveConfig: loadHiveConfigMock,
      loadOpencodeConfig: loadOpencodeConfigSpy,
    });

    await db.insert(cells).values({
      id: cellId,
      name: "Model Test Cell",
      description: "",
      templateId: "template-basic",
      workspacePath: "/tmp/model-test",
      workspaceId: "workspace-1",
      workspaceRootPath: "/tmp/model-test",
      createdAt: new Date(),
      status: "ready",
    });
  });

  afterEach(() => {
    resetAgentRuntimeDependencies();
  });

  it("hydrates runtime model from the last user message", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-user",
            sessionID: "session-restored",
            role: "user",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
            model: {
              providerID: "opencode",
              modelID: "restored-model",
            },
          },
          parts: [],
        },
      ],
    });

    const session = await ensureAgentSession(cellId);

    expect(session.modelId).toBe("restored-model");
    expect(session.modelProviderId).toBe("opencode");
    expect(sessionMessagesMock).toHaveBeenCalled();
  });

  it("sends prompts using the updated provider/model selection", async () => {
    sessionMessagesMock.mockResolvedValue({
      data: [
        {
          info: {
            id: "msg-user",
            sessionID: "session-switch",
            role: "user",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
            model: {
              providerID: "opencode",
              modelID: "restored-model",
            },
          },
          parts: [],
        },
      ],
    });

    const session = await ensureAgentSession(cellId);

    await updateAgentSessionModel(session.id, {
      modelId: "big-pickle",
      providerId: "opencode",
    });

    await sendAgentMessage(session.id, "Run task with new model");

    const promptCall = clientStub.session.prompt.mock.calls.at(-1);
    expect(promptCall).toBeDefined();
    const promptPayload = (
      promptCall?.[0] as {
        body?: { model?: { providerID: string; modelID: string } };
      }
    )?.body;
    expect(promptPayload?.model).toEqual({
      providerID: "opencode",
      modelID: "big-pickle",
    });
  });

  it("prefers the template's agent configuration over opencode defaults", async () => {
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "openai/gpt-5.1-codex-high" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("template-default");
  });

  it("uses workspace defaults when template agents omit models and providers match", async () => {
    const baseTemplate = mockHiveConfig.templates["template-basic"];
    if (!baseTemplate) {
      throw new Error("Test template missing");
    }

    const hiveConfigWithoutModel: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...baseTemplate,
          agent: {
            providerId: "opencode",
          },
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutModel);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "opencode/workspace-default" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "opencode", modelId: "workspace-default" },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("workspace-default");
  });

  it("falls back to hive defaults when workspace defaults target another provider", async () => {
    const baseTemplate = mockHiveConfig.templates["template-basic"];
    if (!baseTemplate) {
      throw new Error("Test template missing");
    }

    const hiveConfigWithoutModel: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...baseTemplate,
          agent: {
            providerId: "opencode",
          },
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutModel);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "openai/opencode-default" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "openai", modelId: "opencode-default" },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("template-default");
  });

  it("uses opencode config defaults when a template omits the agent block", async () => {
    const templateWithoutAgent = mockHiveConfig.templates["template-basic"];
    if (!templateWithoutAgent) {
      throw new Error("Template missing");
    }

    const hiveConfigWithoutAgent: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...templateWithoutAgent,
          agent: undefined,
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutAgent);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "openai/gpt-5.1-codex-high" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("openai");
    expect(session.modelId).toBe("gpt-5.1-codex-high");
  });
});

function buildClientStub(): ClientStub {
  const session = {
    create: vi.fn(async () => ({ data: createMockSession() })),
    get: vi.fn(async () => ({ data: createMockSession() })),
    messages: sessionMessagesMock,
    prompt: vi.fn(async () => ({ error: null })),
  };

  return {
    session,
    event: {
      subscribe: vi.fn(async () => ({
        stream: (async function* () {
          // noop stream
        })(),
      })),
    },
    config: {
      providers: vi.fn(async () => ({
        data: { providers: [], default: {} },
      })),
    },
    postSessionIdPermissionsPermissionId: vi.fn(async () => ({
      error: null,
    })),
  };
}

function createMockSession() {
  const now = Date.now();
  return {
    id: "session-runtime",
    projectID: "project-1",
    directory: "/tmp/model-test",
    title: "Mock Session",
    version: "1",
    time: {
      created: now,
      updated: now,
    },
  };
}
