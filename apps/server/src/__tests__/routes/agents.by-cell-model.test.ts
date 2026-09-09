import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import {
  afterAll as afterAllTests,
  afterEach as afterEachTest,
  beforeAll as beforeAllTests,
  beforeEach as beforeEachTest,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  closeAllAgentSessions,
  resetAgentRuntimeDependencies,
  setAgentRuntimeDependencies,
} from "../../agents/service";
import type { HiveConfig } from "../../config/schema";
import { agentsRoutes } from "../../routes/agents";
import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import {
  applyV2ProviderCatalogFixture,
  createOpenCodeV2ClientFixture,
  createV2ModelFixture,
  createV2SessionFixture,
  type OpenCodeV2ClientFixture,
} from "../opencode-v2-test-fixtures";
import { setupTestDb, testDb } from "../test-db";

type AppDb = typeof import("../../db").db;

const cellId = "cell-by-cell-model";
let workspacePath = "";
const HTTP_OK = 200;

const hiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "template-default",
  },
  promptSources: [],
  templates: {
    "template-basic": {
      id: "template-basic",
      label: "By-cell model template",
      type: "manual",
      agent: {
        providerId: "opencode",
        modelId: "template-default",
      },
    },
  },
  defaults: {},
};

function createClientFixture() {
  const session = createV2SessionFixture({
    id: "session-by-cell-model",
    projectID: "project-by-cell-model",
    title: "By-cell model session",
    directory: workspacePath,
  });
  const fixture = createOpenCodeV2ClientFixture({ session });
  const models = [
    createV2ModelFixture({
      id: "opencode/big-pickle",
      modelID: "big-pickle",
      providerID: "opencode",
      variants: [{ id: "high" }],
    }),
    createV2ModelFixture({
      id: "template-default",
      modelID: "template-default",
      providerID: "opencode",
    }),
  ];
  applyV2ProviderCatalogFixture(fixture, {
    providers: [
      {
        id: "opencode",
        name: "OpenCode",
        activation: "enabled",
        package: "@ai-sdk/opencode",
      },
    ],
    models,
    default: models[1] ?? null,
  });
  return fixture;
}

describe("agents by-cell model capture", () => {
  let clientFixture: OpenCodeV2ClientFixture;

  beforeAllTests(async () => {
    await setupTestDb();
    workspacePath = await mkdtemp(join(tmpdir(), "hive-by-cell-model-"));
  });

  afterAllTests(async () => {
    await rm(workspacePath, { force: true, recursive: true });
  });

  beforeEachTest(async () => {
    vi.restoreAllMocks();
    await closeAllAgentSessions();
    await testDb.delete(cellProvisioningStates);
    await testDb.delete(cells);

    clientFixture = createClientFixture();

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: vi.fn(async () => hiveConfig),
      loadEffectiveOpencodeDefaults: vi.fn(async () => ({})),
      acquireOpencodeClient: vi.fn(async () => clientFixture.client),
    });

    await testDb.insert(cells).values({
      id: cellId,
      name: "By-cell model capture",
      description: null,
      templateId: "template-basic",
      workspacePath,
      workspaceRootPath: workspacePath,
      workspaceId: "workspace-by-cell-model",
      createdAt: new Date(),
      status: "ready",
      opencodeSessionId: null,
      branchName: "cell-by-cell-model",
      baseCommit: null,
      lastSetupError: null,
    });

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "opencode/big-pickle",
      providerIdOverride: "opencode",
      variantOverride: "high",
      startedAt: null,
      finishedAt: null,
      attemptCount: 0,
    });
  });

  afterEachTest(async () => {
    await closeAllAgentSessions();
    resetAgentRuntimeDependencies();
  });

  it("returns selected model before first user prompt", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      new Request(`http://localhost/api/agents/sessions/byCell/${cellId}`)
    );

    const payload = (await response.json()) as {
      message?: string;
      session: {
        modelId?: string;
        modelProviderId?: string;
        modelVariant?: string;
      } | null;
    };
    expect(response.status, payload.message).toBe(HTTP_OK);

    expect(payload.session).not.toBeNull();
    expect(payload.session?.modelId).toBe("opencode/big-pickle");
    expect(payload.session?.modelProviderId).toBe("opencode");
    expect(payload.session?.modelVariant).toBe("high");
    expect(clientFixture.spies.createSession).toHaveBeenCalledWith({
      title: "By-cell model capture",
      agent: "plan",
      model: {
        id: "opencode/big-pickle",
        providerID: "opencode",
        variant: "high",
      },
      location: { directory: workspacePath },
    });
    expect(clientFixture.spies.switchModel).toHaveBeenCalledWith({
      sessionID: "session-by-cell-model",
      model: {
        providerID: "opencode",
        id: "opencode/big-pickle",
        variant: "high",
      },
    });
  });
});
