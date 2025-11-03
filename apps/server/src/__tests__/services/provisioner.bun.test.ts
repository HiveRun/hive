import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyntheticConfig } from "@synthetic/config";
import {
  provisionConstruct,
  startConstructAgent,
} from "../../services/provisioner";
import { cleanupTestDb, createTestDb } from "../utils/test-db";

let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceDir: string;

beforeEach(async () => {
  db = await createTestDb();

  const tempDir = join(tmpdir(), `constructs-test-${Date.now()}`);
  workspaceDir = join(tempDir, "workspace");
  await mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await cleanupTestDb(db);
});

afterEach(async () => {
  if (workspaceDir) {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

describe("provisionConstruct", () => {
  test("creates construct with template", async () => {
    const promptsDir = join(workspaceDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await Bun.write(
      join(promptsDir, "base.md"),
      "# Base Prompt\n\nThis is a test prompt."
    );

    const config: SyntheticConfig = {
      opencode: { workspaceId: "test-workspace" },
      promptSources: ["prompts/*.md"],
      templates: [
        {
          id: "test-template",
          label: "Test Template",
          summary: "A test template",
          type: "implementation",
        },
      ],
    };

    const result = await provisionConstruct(db as any, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    expect(result).toBeDefined();
    expect(result.constructId).toBeDefined();
    expect(result.constructPath).toContain(".constructs");
    expect(result.template.id).toBe("test-template");
  });

  test("allocates service ports", async () => {
    const promptsDir = join(workspaceDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await Bun.write(join(promptsDir, "base.md"), "# Base");

    const config: SyntheticConfig = {
      opencode: { workspaceId: "test" },
      promptSources: ["prompts/*.md"],
      templates: [
        {
          id: "test-template",
          label: "Test Template",
          summary: "Test",
          type: "implementation",
          services: [
            {
              type: "process",
              id: "web",
              name: "Web Server",
              run: "echo test",
              ports: [{ name: "http", preferred: 3000, env: "PORT" }],
            },
          ],
        },
      ],
    };

    const result = await provisionConstruct(db as any, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    expect(result.ports).toBeDefined();
    expect(result.ports.http).toBeDefined();
    expect(result.env.PORT).toBe(result.ports.http?.toString());
  });

  test("rejects invalid template", async () => {
    const config: SyntheticConfig = {
      opencode: { workspaceId: "test" },
      promptSources: [],
      templates: [],
    };

    await expect(
      provisionConstruct(db as any, config, {
        name: "Test",
        templateId: "non-existent",
        workspacePath: workspaceDir,
      })
    ).rejects.toThrow("Template not found");
  });
});

describe("startConstructAgent", () => {
  test("creates agent session", async () => {
    const promptsDir = join(workspaceDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await Bun.write(join(promptsDir, "base.md"), "# Test");

    const config: SyntheticConfig = {
      opencode: { workspaceId: "test" },
      promptSources: ["prompts/*.md"],
      templates: [
        {
          id: "test-template",
          label: "Test",
          summary: "Test",
          type: "planning",
        },
      ],
    };

    const provisioned = await provisionConstruct(db as any, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    const session = await startConstructAgent(
      db as any,
      provisioned.constructId,
      "anthropic"
    );

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.constructId).toBe(provisioned.constructId);
  });

  test("rejects invalid construct", async () => {
    await expect(
      startConstructAgent(db as any, "non-existent")
    ).rejects.toThrow("Construct not found");
  });
});
