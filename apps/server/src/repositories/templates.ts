import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type * as schema from "../schema/templates";
import {
  templates,
  type NewTemplate,
  type Template,
} from "../schema/templates";

export class TemplateRepository {
  private readonly db: LibSQLDatabase<typeof schema>;

  constructor(db: LibSQLDatabase<typeof schema>) {
    this.db = db;
  }

  async create(template: NewTemplate): Promise<Template> {
    const [created] = await this.db
      .insert(templates)
      .values(template)
      .returning();
    if (!created) {
      throw new Error("Failed to create template");
    }
    return created;
  }

  findAll(): Promise<Template[]> {
    return this.db.select().from(templates).orderBy(templates.createdAt);
  }

  async findById(id: string): Promise<Template | undefined> {
    const [template] = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id));
    return template;
  }

  async update(
    id: string,
    data: Partial<NewTemplate>
  ): Promise<Template | undefined> {
    const [updated] = await this.db
      .update(templates)
      .set(data)
      .where(eq(templates.id, id))
      .returning();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(templates).where(eq(templates.id, id));
    return result.rowsAffected > 0;
  }
}
