import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../client";
import type * as schema from "../schema";
import {
  completeConstruct,
  createConstruct,
  deleteConstruct,
  getConstruct,
  listConstructs,
  updateConstruct,
} from "./constructs";

let db: BetterSQLite3Database<typeof schema>;
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `db-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  const dbPath = join(tempDir, "test.db");
  db = createDb({ path: dbPath });

  // Create tables manually since we don't have migrations yet
  db.run(`
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
  `);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("createConstruct", () => {
  it("creates a new construct", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Test Construct",
      description: "A test construct",
    });

    expect(construct).toBeDefined();
    expect(construct.id).toBeDefined();
    expect(construct.name).toBe("Test Construct");
    expect(construct.templateId).toBe("test-template");
    expect(construct.status).toBe("draft");
    expect(construct.type).toBe("implementation");
  });

  it("accepts optional fields", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Test Construct",
      type: "planning",
      workspacePath: "/path/to/workspace",
      metadata: { custom: "data" },
    });

    expect(construct.type).toBe("planning");
    expect(construct.workspacePath).toBe("/path/to/workspace");
    expect(construct.metadata).toEqual({ custom: "data" });
  });
});

describe("getConstruct", () => {
  it("retrieves a construct by ID", async () => {
    const created = await createConstruct(db, {
      templateId: "test-template",
      name: "Test Construct",
    });

    const retrieved = await getConstruct(db, created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.name).toBe("Test Construct");
  });

  it("returns undefined for non-existent ID", async () => {
    const result = await getConstruct(db, "non-existent");
    expect(result).toBeUndefined();
  });
});

describe("listConstructs", () => {
  beforeEach(async () => {
    await createConstruct(db, {
      templateId: "template-1",
      name: "Construct 1",
      type: "implementation",
    });
    await createConstruct(db, {
      templateId: "template-2",
      name: "Construct 2",
      type: "planning",
    });
    await createConstruct(db, {
      templateId: "template-3",
      name: "Construct 3",
      type: "implementation",
    });
  });

  it("lists all constructs", async () => {
    const constructs = await listConstructs(db);
    expect(constructs).toHaveLength(3);
  });

  it("filters by type", async () => {
    const constructs = await listConstructs(db, { type: "planning" });
    expect(constructs).toHaveLength(1);
    expect(constructs[0].name).toBe("Construct 2");
  });

  it("filters by status", async () => {
    const constructs = await listConstructs(db, { status: "draft" });
    expect(constructs).toHaveLength(3);
  });

  it("respects limit and offset", async () => {
    const page1 = await listConstructs(db, { limit: 2, offset: 0 });
    const page2 = await listConstructs(db, { limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
  });
});

describe("updateConstruct", () => {
  it("updates construct fields", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Original Name",
    });

    const updated = await updateConstruct(db, construct.id, {
      name: "Updated Name",
      status: "active",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.status).toBe("active");
  });

  it("updates metadata", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Test",
      metadata: { old: "data" },
    });

    const updated = await updateConstruct(db, construct.id, {
      metadata: { new: "data" },
    });

    expect(updated.metadata).toEqual({ new: "data" });
  });
});

describe("completeConstruct", () => {
  it("marks construct as completed", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Test",
    });

    const completed = await completeConstruct(db, construct.id);

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeDefined();
  });
});

describe("deleteConstruct", () => {
  it("deletes a construct", async () => {
    const construct = await createConstruct(db, {
      templateId: "test-template",
      name: "Test",
    });

    await deleteConstruct(db, construct.id);

    const retrieved = await getConstruct(db, construct.id);
    expect(retrieved).toBeUndefined();
  });
});
