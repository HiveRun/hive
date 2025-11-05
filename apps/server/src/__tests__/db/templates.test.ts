import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createTemplateQueries } from "../../db/templates";
import type * as schemaModule from "../../schema/templates";
import { templates, templateType } from "../../schema/templates";

const schema: typeof schemaModule = {
  templateType,
  templates,
};

function setupTestDb() {
  const client = createClient({ url: ":memory:" });
  const database = drizzle<typeof schemaModule>({ client, schema });
  return { database, db: createTemplateQueries(database) };
}

describe("Template queries", () => {
  let database: ReturnType<typeof drizzle<typeof schemaModule>>;
  let db: ReturnType<typeof createTemplateQueries>;

  beforeEach(async () => {
    ({ database, db } = setupTestDb());
    await migrate(database, { migrationsFolder: "./src/migrations" });
  });

  describe("create", () => {
    it("should create a template", async () => {
      const input = {
        id: "test-template",
        label: "Test Template",
        type: "manual" as const,
        configJson: { services: {} },
      };

      const template = await db.create(input);

      expect(template.id).toBe(input.id);
      expect(template.label).toBe(input.label);
      expect(template.type).toBe(input.type);
    });
  });

  describe("findAll", () => {
    it("should return empty array when no templates exist", async () => {
      const result = await db.findAll();
      expect(result).toEqual([]);
    });

    it("should return all templates ordered by creation date", async () => {
      await db.create({
        id: "template-1",
        label: "Template 1",
        type: "manual",
        configJson: {},
      });

      await db.create({
        id: "template-2",
        label: "Template 2",
        type: "manual",
        configJson: {},
      });

      const allTemplates = await db.findAll();
      expect(allTemplates).toHaveLength(2);
      expect(allTemplates[0]?.id).toBe("template-1");
      expect(allTemplates[1]?.id).toBe("template-2");
    });
  });

  describe("findById", () => {
    it("should return undefined when template does not exist", async () => {
      const template = await db.findById("non-existent");
      expect(template).toBeUndefined();
    });

    it("should return template when it exists", async () => {
      const input = {
        id: "existing",
        label: "Existing",
        type: "manual" as const,
        configJson: { test: true },
      };

      await db.create(input);
      const template = await db.findById(input.id);

      expect(template).toBeDefined();
      if (template) {
        expect(template.id).toBe(input.id);
        expect(template.configJson).toEqual(input.configJson);
      }
    });
  });

  describe("update", () => {
    it("should return undefined when template does not exist", async () => {
      const updated = await db.update("non-existent", { label: "New Label" });
      expect(updated).toBeUndefined();
    });

    it("should update template fields", async () => {
      await db.create({
        id: "updateable",
        label: "Original",
        type: "manual",
        configJson: {},
      });

      const newLabel = "Updated";
      const updated = await db.update("updateable", { label: newLabel });

      expect(updated?.label).toBe(newLabel);
    });
  });

  describe("delete", () => {
    it("should return false when template does not exist", async () => {
      const deleted = await db.delete("non-existent");
      expect(deleted).toBe(false);
    });

    it("should delete template and return true", async () => {
      const input = {
        id: "deletable",
        label: "Deletable",
        type: "manual" as const,
        configJson: {},
      };

      await db.create(input);
      const deleted = await db.delete(input.id);
      expect(deleted).toBe(true);

      const found = await db.findById(input.id);
      expect(found).toBeUndefined();
    });
  });
});
