import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../config/context";
import { cells } from "../schema/cells";
import { setupTestDb, testDb } from "./test-db";

describe("Cells CRUD Operations", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    // Clean up before each test
    await testDb.delete(cells);
  });

  afterEach(async () => {
    // Clean up after each test
    await testDb.delete(cells);
  });

  const workspaceFields = {
    workspaceId: "test-workspace",
    workspaceRootPath: resolveWorkspaceRoot(),
  };

  describe("Create", () => {
    it("should create a cell with valid data", async () => {
      const newCell = {
        id: "test-cell-1",
        name: "Test Cell",
        description: "A test cell",
        templateId: "basic",
        workspacePath: "/tmp/test-worktree-1",
        createdAt: new Date(),
        status: "ready" as const,
        phase: "implementation" as const,
        ...workspaceFields,
      };

      const [created] = await testDb.insert(cells).values(newCell).returning();

      expect(created).toBeDefined();
      if (!created) {
        throw new Error("Insert did not return cell");
      }

      expect(created).toMatchObject({
        id: newCell.id,
        name: newCell.name,
        description: newCell.description,
        templateId: newCell.templateId,
      });
    });

    it("should create a cell without description", async () => {
      const newCell = {
        id: "test-cell-2",
        name: "Minimal Cell",
        templateId: "basic",
        workspacePath: "/tmp/test-worktree-2",
        createdAt: new Date(),
        status: "ready" as const,
        phase: "implementation" as const,
        ...workspaceFields,
      };

      const [created] = await testDb.insert(cells).values(newCell).returning();

      expect(created).toBeDefined();
      if (!created) {
        throw new Error("Insert did not return cell");
      }

      expect(created.description).toBeNull();
    });
  });

  describe("Read", () => {
    beforeEach(async () => {
      // Insert test data
      await testDb.insert(cells).values([
        {
          id: "cell-1",
          name: "First Cell",
          description: "First test cell",
          templateId: "basic",
          workspacePath: "/tmp/test-worktree-1",
          createdAt: new Date(),
          status: "ready" as const,
          phase: "implementation" as const,
          ...workspaceFields,
        },
        {
          id: "cell-2",
          name: "Second Cell",
          description: "Second test cell",
          templateId: "web-api",
          workspacePath: "/tmp/test-worktree-2",
          createdAt: new Date(),
          status: "ready" as const,
          phase: "implementation" as const,
          ...workspaceFields,
        },
      ]);
    });

    it("should retrieve all cells", async () => {
      const allCells = await testDb.select().from(cells);

      expect(allCells).toHaveLength(2);

      const [first, second] = allCells;
      if (!(first && second)) {
        throw new Error("Expected two cells");
      }

      expect(first.name).toBe("First Cell");
      expect(second.name).toBe("Second Cell");
    });

    it("should retrieve a cell by ID", async () => {
      const [found] = await testDb
        .select()
        .from(cells)
        .where(eq(cells.id, "cell-1"))
        .limit(1);

      expect(found).toBeDefined();
      if (!found) {
        throw new Error("Cell not found");
      }

      expect(found.name).toBe("First Cell");
    });

    it("should return empty array for non-existent ID", async () => {
      const result = await testDb
        .select()
        .from(cells)
        .where(eq(cells.id, "non-existent"))
        .limit(1);

      expect(result).toHaveLength(0);
    });
  });

  describe("Delete", () => {
    let cellId: string;

    beforeEach(async () => {
      const [created] = await testDb
        .insert(cells)
        .values({
          id: "cell-to-delete",
          name: "To Delete",
          templateId: "basic",
          workspacePath: "/tmp/test-worktree-delete",
          createdAt: new Date(),
          status: "ready",
          ...workspaceFields,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to insert cell for delete tests");
      }

      cellId = created.id;
    });

    it("should delete existing cell", async () => {
      const [deleted] = await testDb
        .delete(cells)
        .where(eq(cells.id, cellId))
        .returning();

      expect(deleted).toBeDefined();
      if (!deleted) {
        throw new Error("Delete did not return cell");
      }

      expect(deleted.id).toBe(cellId);

      // Verify it's actually deleted
      const verifyResult = await testDb
        .select()
        .from(cells)
        .where(eq(cells.id, cellId))
        .limit(1);

      expect(verifyResult).toHaveLength(0);
    });

    it("should not delete non-existent cell", async () => {
      const result = await testDb
        .delete(cells)
        .where(eq(cells.id, "non-existent"))
        .returning();

      expect(result).toHaveLength(0);
    });
  });
});
