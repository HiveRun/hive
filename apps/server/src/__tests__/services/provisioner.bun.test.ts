import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyntheticConfig } from "@synthetic/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { type DbInstance, schema } from "../../db";
import {
  provisionConstruct,
  startConstructAgent,
} from "../../services/provisioner";

let db: DbInstance;
let tempDir: string;
let workspaceDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `constructs-test-${Date.now()}`);
  workspaceDir = join(tempDir, "workspace");
  await mkdir(workspaceDir, { recursive: true });

  const dbPath = join(tempDir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema }) as unknown as DbInstance;

  // Create tables using Drizzle's sql
  await db.run(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS constructs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'implementation',
      status TEXT NOT NULL DEFAULT 'draft',
      workspace_path TEXT,
      construct_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      metadata TEXT
    )
  `)
  );

  await db.run(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS prompt_bundles (
      id TEXT PRIMARY KEY,
      construct_id TEXT NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT,
      FOREIGN KEY (construct_id) REFERENCES constructs(id) ON DELETE CASCADE
    )
  `)
  );

  await db.run(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      construct_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      error_message TEXT,
      metadata TEXT,
      FOREIGN KEY (construct_id) REFERENCES constructs(id) ON DELETE CASCADE
    )
  `)
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("provisionConstruct", () => {
  test("provisions a basic construct", async () => {
    // Create a test prompt file
    const promptsDir = join(workspaceDir, "prompts");
    await mkdir(promptsDir, { recursive: true });
    await Bun.write(
      join(promptsDir, "base.md"),
      "# Base Prompt\n\nThis is a test prompt."
    );

    const config: SyntheticConfig = {
      opencode: {
        workspaceId: "test-workspace",
      },
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

    const result = await provisionConstruct(db, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    expect(result).toBeDefined();
    expect(result.constructId).toBeDefined();
    expect(result.constructPath).toContain(".constructs");
    expect(result.template.id).toBe("test-template");
  });

  test("allocates ports for services", async () => {
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

    const result = await provisionConstruct(db, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    expect(result.ports).toBeDefined();
    expect(result.ports.http).toBeDefined();
    expect(result.env.PORT).toBe(result.ports.http?.toString());
  });

  test("throws error for non-existent template", async () => {
    const config: SyntheticConfig = {
      opencode: { workspaceId: "test" },
      promptSources: [],
      templates: [],
    };

    await expect(
      provisionConstruct(db, config, {
        name: "Test",
        templateId: "non-existent",
        workspacePath: workspaceDir,
      })
    ).rejects.toThrow("Template not found");
  });
});

describe("startConstructAgent", () => {
  test("starts an agent session for a construct", async () => {
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

    const provisioned = await provisionConstruct(db, config, {
      name: "Test Construct",
      templateId: "test-template",
      workspacePath: workspaceDir,
    });

    const session = await startConstructAgent(
      db,
      provisioned.constructId,
      "anthropic"
    );

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.constructId).toBe(provisioned.constructId);
  });

  test("throws error for non-existent construct", async () => {
    await expect(startConstructAgent(db, "non-existent")).rejects.toThrow(
      "Construct not found"
    );
  });
});
