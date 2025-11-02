import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { generateId } from "../client";
import type { ConstructStatus, ConstructType } from "../schema";
import * as schema from "../schema";

export type CreateConstructInput = {
  templateId: string;
  name: string;
  description?: string;
  type?: ConstructType;
  workspacePath?: string;
  constructPath?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateConstructInput = {
  name?: string;
  description?: string;
  status?: ConstructStatus;
  workspacePath?: string;
  constructPath?: string;
  metadata?: Record<string, unknown>;
};

export type ListConstructsOptions = {
  status?: ConstructStatus;
  type?: ConstructType;
  limit?: number;
  offset?: number;
};

/**
 * Create a new construct
 */
export async function createConstruct(
  db: BetterSQLite3Database<typeof schema>,
  input: CreateConstructInput
) {
  const id = generateId();

  const [construct] = await db
    .insert(schema.constructs)
    .values({
      id,
      ...input,
    })
    .returning();

  return construct;
}

/**
 * Get construct by ID
 */
export async function getConstruct(
  db: BetterSQLite3Database<typeof schema>,
  id: string
) {
  return await db.query.constructs.findFirst({
    where: eq(schema.constructs.id, id),
  });
}

/**
 * List constructs with optional filtering
 */
export async function listConstructs(
  db: BetterSQLite3Database<typeof schema>,
  options: ListConstructsOptions = {}
) {
  const { status, type, limit = 50, offset = 0 } = options;

  let query = db.select().from(schema.constructs);

  const conditions = [];
  if (status) {
    conditions.push(eq(schema.constructs.status, status));
  }
  if (type) {
    conditions.push(eq(schema.constructs.type, type));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(desc(schema.constructs.createdAt))
    .limit(limit)
    .offset(offset);

  return results;
}

/**
 * Update construct
 */
export async function updateConstruct(
  db: BetterSQLite3Database<typeof schema>,
  id: string,
  input: UpdateConstructInput
) {
  const [updated] = await db
    .update(schema.constructs)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(schema.constructs.id, id))
    .returning();

  return updated;
}

/**
 * Mark construct as completed
 */
export async function completeConstruct(
  db: BetterSQLite3Database<typeof schema>,
  id: string
) {
  const [updated] = await db
    .update(schema.constructs)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.constructs.id, id))
    .returning();

  return updated;
}

/**
 * Delete construct (cascades to all related records)
 */
export async function deleteConstruct(
  db: BetterSQLite3Database<typeof schema>,
  id: string
) {
  await db.delete(schema.constructs).where(eq(schema.constructs.id, id));
}
