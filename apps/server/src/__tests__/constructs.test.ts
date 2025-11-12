import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { constructs } from "../schema/constructs";
import { setupTestDb, testDb } from "./test-db";

describe("Constructs CRUD Operations", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    // Clean up before each test
    await testDb.delete(constructs);
  });

  afterEach(async () => {
    // Clean up after each test
    await testDb.delete(constructs);
  });

  describe("Create", () => {
    it("should create a construct with valid data", async () => {
      const newConstruct = {
        id: "test-construct-1",
        name: "Test Construct",
        description: "A test construct",
        templateId: "basic",
        workspacePath: "/tmp/test-worktree-1",
        createdAt: new Date(),
        status: "ready",
      };

      const [created] = await testDb
        .insert(constructs)
        .values(newConstruct)
        .returning();

      expect(created).toBeDefined();
      if (!created) {
        throw new Error("Insert did not return construct");
      }

      expect(created).toMatchObject({
        id: newConstruct.id,
        name: newConstruct.name,
        description: newConstruct.description,
        templateId: newConstruct.templateId,
      });
    });

    it("should create a construct without description", async () => {
      const newConstruct = {
        id: "test-construct-2",
        name: "Minimal Construct",
        templateId: "basic",
        workspacePath: "/tmp/test-worktree-2",
        createdAt: new Date(),
        status: "ready",
      };

      const [created] = await testDb
        .insert(constructs)
        .values(newConstruct)
        .returning();

      expect(created).toBeDefined();
      if (!created) {
        throw new Error("Insert did not return construct");
      }

      expect(created.description).toBeNull();
    });
  });

  describe("Read", () => {
    beforeEach(async () => {
      // Insert test data
      await testDb.insert(constructs).values([
        {
          id: "construct-1",
          name: "First Construct",
          description: "First test construct",
          templateId: "basic",
          workspacePath: "/tmp/test-worktree-1",
          createdAt: new Date(),
          status: "ready",
        },
        {
          id: "construct-2",
          name: "Second Construct",
          description: "Second test construct",
          templateId: "web-api",
          workspacePath: "/tmp/test-worktree-2",
          createdAt: new Date(),
          status: "ready",
        },
      ]);
    });

    it("should retrieve all constructs", async () => {
      const allConstructs = await testDb.select().from(constructs);

      expect(allConstructs).toHaveLength(2);

      const [first, second] = allConstructs;
      if (!(first && second)) {
        throw new Error("Expected two constructs");
      }

      expect(first.name).toBe("First Construct");
      expect(second.name).toBe("Second Construct");
    });

    it("should retrieve a construct by ID", async () => {
      const [found] = await testDb
        .select()
        .from(constructs)
        .where(eq(constructs.id, "construct-1"))
        .limit(1);

      expect(found).toBeDefined();
      if (!found) {
        throw new Error("Construct not found");
      }

      expect(found.name).toBe("First Construct");
    });

    it("should return empty array for non-existent ID", async () => {
      const result = await testDb
        .select()
        .from(constructs)
        .where(eq(constructs.id, "non-existent"))
        .limit(1);

      expect(result).toHaveLength(0);
    });
  });

  describe("Delete", () => {
    let constructId: string;

    beforeEach(async () => {
      const [created] = await testDb
        .insert(constructs)
        .values({
          id: "construct-to-delete",
          name: "To Delete",
          templateId: "basic",
          workspacePath: "/tmp/test-worktree-delete",
          createdAt: new Date(),
          status: "ready",
        })
        .returning();

      if (!created) {
        throw new Error("Failed to insert construct for delete tests");
      }

      constructId = created.id;
    });

    it("should delete existing construct", async () => {
      const [deleted] = await testDb
        .delete(constructs)
        .where(eq(constructs.id, constructId))
        .returning();

      expect(deleted).toBeDefined();
      if (!deleted) {
        throw new Error("Delete did not return construct");
      }

      expect(deleted.id).toBe(constructId);

      // Verify it's actually deleted
      const verifyResult = await testDb
        .select()
        .from(constructs)
        .where(eq(constructs.id, constructId))
        .limit(1);

      expect(verifyResult).toHaveLength(0);
    });

    it("should not delete non-existent construct", async () => {
      const result = await testDb
        .delete(constructs)
        .where(eq(constructs.id, "non-existent"))
        .returning();

      expect(result).toHaveLength(0);
    });
  });
});
