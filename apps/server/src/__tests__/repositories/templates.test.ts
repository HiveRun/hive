import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { TemplateRepository } from "../../repositories/templates";
import * as schema from "../../schema/templates";

describe("TemplateRepository", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: TemplateRepository;

  beforeEach(async () => {
    const client = createClient({ url: ":memory:" });
    db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "./src/migrations" });
    repo = new TemplateRepository(db);
  });

  describe("create", () => {
    it("should create a template", async () => {
      const template = await repo.create({
        id: "test-template",
        label: "Test Template",
        type: "manual",
        configJson: { services: {} },
      });

      expect(template.id).toBe("test-template");
      expect(template.label).toBe("Test Template");
      expect(template.type).toBe("manual");
    });
  });

  describe("findAll", () => {
    it("should return empty array when no templates exist", async () => {
      const templates = await repo.findAll();
      expect(templates).toEqual([]);
    });

    it("should return all templates ordered by creation date", async () => {
      await repo.create({
        id: "template-1",
        label: "Template 1",
        type: "manual",
        configJson: {},
      });

      await repo.create({
        id: "template-2",
        label: "Template 2",
        type: "manual",
        configJson: {},
      });

      const templates = await repo.findAll();
      expect(templates).toHaveLength(2);
      expect(templates[0]?.id).toBe("template-1");
      expect(templates[1]?.id).toBe("template-2");
    });
  });

  describe("findById", () => {
    it("should return undefined when template does not exist", async () => {
      const template = await repo.findById("non-existent");
      expect(template).toBeUndefined();
    });

    it("should return template when it exists", async () => {
      await repo.create({
        id: "existing",
        label: "Existing",
        type: "manual",
        configJson: { test: true },
      });

      const template = await repo.findById("existing");
      expect(template).toBeDefined();
      if (template) {
        expect(template.id).toBe("existing");
        expect(template.configJson).toEqual({ test: true });
      }
    });
  });

  describe("update", () => {
    it("should return undefined when template does not exist", async () => {
      const updated = await repo.update("non-existent", { label: "New Label" });
      expect(updated).toBeUndefined();
    });

    it("should update template fields", async () => {
      await repo.create({
        id: "updateable",
        label: "Original",
        type: "manual",
        configJson: {},
      });

      const updated = await repo.update("updateable", {
        label: "Updated",
      });

      expect(updated?.label).toBe("Updated");
    });
  });

  describe("delete", () => {
    it("should return false when template does not exist", async () => {
      const deleted = await repo.delete("non-existent");
      expect(deleted).toBe(false);
    });

    it("should delete template and return true", async () => {
      await repo.create({
        id: "deletable",
        label: "Deletable",
        type: "manual",
        configJson: {},
      });

      const deleted = await repo.delete("deletable");
      expect(deleted).toBe(true);

      const found = await repo.findById("deletable");
      expect(found).toBeUndefined();
    });
  });
});
