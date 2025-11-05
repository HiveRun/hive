import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../schema/templates";
import {
  type NewTemplate,
  type Template,
  templates,
} from "../schema/templates";

export function createTemplateQueries(db: LibSQLDatabase<typeof schema>) {
  return {
    async create(template: NewTemplate): Promise<Template> {
      const [created] = await db.insert(templates).values(template).returning();
      if (!created) {
        throw new Error("Failed to create template");
      }
      return created;
    },

    findAll(): Promise<Template[]> {
      return db.select().from(templates).orderBy(templates.createdAt);
    },

    async findById(id: string): Promise<Template | undefined> {
      const [template] = await db
        .select()
        .from(templates)
        .where(eq(templates.id, id));
      return template;
    },

    async update(
      id: string,
      data: Partial<NewTemplate>
    ): Promise<Template | undefined> {
      const [updated] = await db
        .update(templates)
        .set(data)
        .where(eq(templates.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(templates).where(eq(templates.id, id));
      return result.rowsAffected > 0;
    },
  };
}
