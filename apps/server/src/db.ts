import { createClient } from "@libsql/client";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  agentStatusSchema,
  type ConstructStatus,
  constructStatusSchema,
  constructStatusTransitions,
  isValidConstructStatusTransition,
  isValidServiceStatusTransition,
  type ServiceStatus,
  serviceStatusSchema,
  serviceStatusTransitions,
} from "./lib/schema";

export const constructs = sqliteTable("constructs", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("implementation"),
  status: text("status", {
    enum: constructStatusSchema.options as unknown as readonly [
      string,
      ...string[],
    ],
  })
    .notNull()
    .default("draft"),
  workspacePath: text("workspace_path"),
  constructPath: text("construct_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
  metadata: text("metadata", { mode: "json" }),
});

export const promptBundles = sqliteTable("prompt_bundles", {
  id: text("id").primaryKey(),
  constructId: text("construct_id").notNull(),
  content: text("content").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  createdAt: integer("created_at").notNull(),
  metadata: text("metadata", { mode: "json" }),
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  constructId: text("construct_id").notNull(),
  sessionId: text("session_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status", {
    enum: agentStatusSchema.options as unknown as readonly [
      string,
      ...string[],
    ],
  })
    .notNull()
    .default("starting"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
  errorMessage: text("error_message"),
  metadata: text("metadata", { mode: "json" }),
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  constructId: text("construct_id").notNull(),
  serviceName: text("service_name").notNull(),
  serviceType: text("service_type").notNull().default("process"),
  status: text("status", {
    enum: serviceStatusSchema.options as unknown as readonly [
      string,
      ...string[],
    ],
  })
    .notNull()
    .default("stopped"),
  pid: integer("pid"),
  containerId: text("container_id"),
  command: text("command"),
  cwd: text("cwd"),
  env: text("env", { mode: "json" }),
  ports: text("ports", { mode: "json" }),
  volumes: text("volumes", { mode: "json" }),
  healthStatus: text("health_status").default("unknown"),
  lastHealthCheck: integer("last_health_check"),
  cpuUsage: text("cpu_usage"),
  memoryUsage: text("memory_usage"),
  diskUsage: text("disk_usage"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  stoppedAt: integer("stopped_at"),
  metadata: text("metadata", { mode: "json" }),
});

export const schema = {
  constructs,
  promptBundles,
  agentSessions,
  services,
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.trim().length === 0) {
  throw new Error(
    "DATABASE_URL environment variable is required. For local development, set DATABASE_URL=file:./synthetic.db in apps/server/.env"
  );
}

const client = createClient({
  url: databaseUrl,
});

export type DbInstance = typeof db;
export type BetterSQLite3Database = typeof db;

export const db = drizzle({ client, schema });
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
    description: string | null;
    status: ConstructStatus;
    workspacePath: string | null;
    constructPath: string | null;
    completedAt: number | null;
    metadata: Record<string, unknown> | null;
  }>
) {
  // Validate status transition if status is being updated
  if (updates.status) {
    const existing = await getConstruct(db, id);
    if (
      existing &&
      existing.status !== updates.status &&
      !isValidConstructStatusTransition(
        existing.status as ConstructStatus,
        updates.status
      )
    ) {
      throw new Error(
        `Invalid construct status transition: ${existing.status} → ${updates.status}. ` +
          `Valid transitions from ${existing.status}: ${constructStatusTransitions[existing.status as ConstructStatus]?.join(", ") || "none"}`
      );
    }
  }

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

export async function createService(
  db: DbInstance,
  service: {
    id: string;
    constructId: string;
    serviceName: string;
    serviceType?: string;
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
    ports?: Record<string, number>;
    volumes?: Record<string, string>;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  const [result] = await db
    .insert(schema.services)
    .values({
      ...service,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return result;
}

export async function getService(db: DbInstance, id: string) {
  return await db.query.services.findFirst({
    where: eq(schema.services.id, id),
  });
}

export async function getServicesByConstruct(
  db: DbInstance,
  constructId: string
) {
  return await db.query.services.findMany({
    where: eq(schema.services.constructId, constructId),
  });
}

export async function updateService(
  db: DbInstance,
  id: string,
  updates: Partial<{
    status: ServiceStatus;
    pid: number;
    containerId: string;
    healthStatus: string;
    lastHealthCheck: number;
    cpuUsage: string;
    memoryUsage: string;
    diskUsage: string;
    errorMessage: string;
    startedAt: number;
    stoppedAt: number;
    metadata: Record<string, unknown>;
  }>
) {
  // Validate status transition if status is being updated
  if (updates.status) {
    const existing = await getService(db, id);
    if (
      existing &&
      existing.status !== updates.status &&
      !isValidServiceStatusTransition(
        existing.status as ServiceStatus,
        updates.status
      )
    ) {
      throw new Error(
        `Invalid service status transition: ${existing.status} → ${updates.status}. ` +
          `Valid transitions from ${existing.status}: ${serviceStatusTransitions[existing.status as ServiceStatus]?.join(", ") || "none"}`
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const [result] = await db
    .update(schema.services)
    .set({ ...updates, updatedAt: now })
    .where(eq(schema.services.id, id))
    .returning();
  return result;
}

export async function deleteService(db: DbInstance, id: string) {
  await db.delete(schema.services).where(eq(schema.services.id, id));
}

export async function deleteServicesByConstruct(
  db: DbInstance,
  constructId: string
) {
  await db
    .delete(schema.services)
    .where(eq(schema.services.constructId, constructId));
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
