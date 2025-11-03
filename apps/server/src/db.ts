import { createClient } from "@libsql/client";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Schema
export const schema = {
  constructs: sqliteTable("constructs", {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull().default("implementation"),
    status: text("status").notNull().default("draft"),
    workspacePath: text("workspace_path"),
    constructPath: text("construct_path"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    metadata: text("metadata", { mode: "json" }),
  }),
  promptBundles: sqliteTable("prompt_bundles", {
    id: text("id").primaryKey(),
    constructId: text("construct_id").notNull(),
    content: text("content").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    createdAt: integer("created_at").notNull(),
    metadata: text("metadata", { mode: "json" }),
  }),
  agentSessions: sqliteTable("agent_sessions", {
    id: text("id").primaryKey(),
    constructId: text("construct_id").notNull(),
    sessionId: text("session_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("starting"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }),
  }),
};

const client = createClient({
  url: process.env.DATABASE_URL || "",
});

// Types
export type DbInstance = typeof db;
export type BetterSQLite3Database = typeof db;

// Initialize database with schema
export const db = drizzle({ client, schema });

// Database operations
export async function createConstruct(
  db: DbInstance,
  construct: {
    id: string;
    templateId: string;
    name: string;
    description?: string;
    type?: string;
    workspacePath?: string;
    constructPath?: string;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  const [result] = await db
    .insert(schema.constructs)
    .values({
      ...construct,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return result;
}

export async function getConstruct(db: DbInstance, id: string) {
  return await db.query.constructs.findFirst({
    where: eq(schema.constructs.id, id),
  });
}

export async function listConstructs(db: DbInstance) {
  return await db.query.constructs.findMany({
    orderBy: desc(schema.constructs.createdAt),
  });
}

export async function updateConstruct(
  db: DbInstance,
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    status: string;
    workspacePath: string;
    constructPath: string;
    completedAt: number;
    metadata: Record<string, unknown>;
  }>
) {
  const now = Math.floor(Date.now() / 1000);
  const [result] = await db
    .update(schema.constructs)
    .set({ ...updates, updatedAt: now })
    .where(eq(schema.constructs.id, id))
    .returning();
  return result;
}

export async function deleteConstruct(db: DbInstance, id: string) {
  await db.delete(schema.constructs).where(eq(schema.constructs.id, id));
}

export async function completeConstruct(db: DbInstance, id: string) {
  const now = Math.floor(Date.now() / 1000);
  const [result] = await db
    .update(schema.constructs)
    .set({
      status: "completed",
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.constructs.id, id))
    .returning();
  return result;
}

export function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function createDb() {
  return db;
}
