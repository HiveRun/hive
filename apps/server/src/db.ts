import { createClient } from "@libsql/client";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Tables
export const constructs = sqliteTable("constructs", {
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
  status: text("status").notNull().default("starting"),
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
  serviceType: text("service_type").notNull().default("process"), // "process" | "docker" | "compose"
  status: text("status").notNull().default("stopped"), // "running" | "stopped" | "needs_resume" | "error"
  pid: integer("pid"), // Process ID for process services
  containerId: text("container_id"), // Container ID for Docker services
  command: text("command"), // Command used to start the service
  cwd: text("cwd"), // Working directory
  env: text("env", { mode: "json" }), // Environment variables
  ports: text("ports", { mode: "json" }), // Port mappings
  volumes: text("volumes", { mode: "json" }), // Volume mappings
  healthStatus: text("health_status").default("unknown"), // "healthy" | "unhealthy" | "unknown"
  lastHealthCheck: integer("last_health_check"),
  cpuUsage: text("cpu_usage"), // CPU usage as string percentage
  memoryUsage: text("memory_usage"), // Memory usage as string
  diskUsage: text("disk_usage"), // Disk usage as string
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  stoppedAt: integer("stopped_at"),
  metadata: text("metadata", { mode: "json" }),
});

// Schema
export const schema = {
  constructs,
  promptBundles,
  agentSessions,
  services,
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

// Service operations
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
    status: string;
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
