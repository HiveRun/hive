import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Construct status enum
 */
export const constructStatus = [
  "draft",
  "provisioning",
  "active",
  "awaiting_input",
  "reviewing",
  "completed",
  "parked",
  "archived",
  "error",
] as const;

export type ConstructStatus = (typeof constructStatus)[number];

/**
 * Construct type enum
 */
export const constructType = ["implementation", "planning", "manual"] as const;

export type ConstructType = (typeof constructType)[number];

/**
 * Constructs table - stores high-level construct metadata
 */
export const constructs = sqliteTable("constructs", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: constructType })
    .notNull()
    .default("implementation"),
  status: text("status", { enum: constructStatus }).notNull().default("draft"),
  workspacePath: text("workspace_path"),
  constructPath: text("construct_path"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  metadata: text("metadata", { mode: "json" }), // Additional construct-specific data
});

/**
 * Services table - tracks running services for each construct
 */
export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
  serviceId: text("service_id").notNull(), // From template
  name: text("name").notNull(),
  type: text("type", { enum: ["process", "docker", "compose"] }).notNull(),
  status: text("status", {
    enum: ["starting", "running", "stopped", "error"],
  })
    .notNull()
    .default("stopped"),
  pid: integer("pid"), // For process services
  containerId: text("container_id"), // For docker services
  ports: text("ports", { mode: "json" }), // Allocated ports as JSON
  env: text("env", { mode: "json" }), // Environment variables
  startedAt: integer("started_at", { mode: "timestamp" }),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
  metadata: text("metadata", { mode: "json" }),
});

/**
 * Agent sessions table - tracks OpenCode agent sessions
 */
export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(), // OpenCode session ID
  provider: text("provider").notNull(), // e.g., "anthropic", "openai"
  status: text("status", {
    enum: ["starting", "working", "awaiting_input", "completed", "error"],
  })
    .notNull()
    .default("starting"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  metadata: text("metadata", { mode: "json" }),
});

/**
 * Transcript messages table - stores agent conversation messages
 */
export const transcriptMessages = sqliteTable("transcript_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  metadata: text("metadata", { mode: "json" }), // Tool calls, attachments, etc.
});

/**
 * Artifacts table - references to stored files (diffs, logs, etc.)
 */
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["diff", "log", "plan", "transcript", "other"],
  }).notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(), // Relative path in artifacts storage
  size: integer("size").notNull(), // File size in bytes
  mimeType: text("mime_type"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  metadata: text("metadata", { mode: "json" }),
});

/**
 * Port allocations table - tracks allocated ports
 */
export const portAllocations = sqliteTable("port_allocations", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Port name from template
  port: integer("port").notNull(),
  allocatedAt: integer("allocated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Prompt bundles table - stores assembled prompt bundles
 */
export const promptBundles = sqliteTable("prompt_bundles", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  metadata: text("metadata", { mode: "json" }), // Fragment info, variables, etc.
});
