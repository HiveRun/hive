import { z } from "zod";

// Unified status enums - single source of truth
export const constructStatusSchema = z.enum([
  "draft",
  "provisioning",
  "active",
  "awaiting_input",
  "reviewing",
  "completed",
  "parked",
  "archived",
  "error",
]);

export type ConstructStatus = z.infer<typeof constructStatusSchema>;

export const agentStatusSchema = z.enum([
  "starting",
  "running",
  "stopped",
  "completed",
  "error",
]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const serviceStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "error",
  "unknown",
]);

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

// State machine validation for construct status transitions
export const constructStatusTransitions = {
  draft: ["provisioning", "active", "archived", "error"],
  provisioning: ["draft", "active", "error"],
  active: ["awaiting_input", "reviewing", "completed", "parked", "error"],
  awaiting_input: ["active", "reviewing", "parked", "error"],
  reviewing: ["active", "completed", "parked", "error"],
  completed: ["archived"],
  parked: ["active", "archived"],
  archived: [], // Terminal state
  error: ["draft", "active", "archived"], // Can retry or give up and resume work
} as const;

export function isValidConstructStatusTransition(
  from: ConstructStatus,
  to: ConstructStatus
): boolean {
  return (
    (
      constructStatusTransitions as Record<
        ConstructStatus,
        readonly ConstructStatus[]
      >
    )[from]?.includes(to) ?? false
  );
}

// State machine validation for agent status transitions
export const agentStatusTransitions = {
  starting: ["running", "stopped", "error"],
  running: ["stopped", "completed", "error"],
  stopped: ["starting", "completed"],
  completed: [], // Terminal state
  error: ["starting"], // Can retry
} as const;

export function isValidAgentStatusTransition(
  from: AgentStatus,
  to: AgentStatus
): boolean {
  return (
    (agentStatusTransitions as Record<AgentStatus, readonly AgentStatus[]>)[
      from
    ]?.includes(to) ?? false
  );
}

// State machine validation for service status transitions
export const serviceStatusTransitions = {
  unknown: ["stopped", "starting", "error"],
  stopped: ["starting", "error"],
  starting: ["running", "stopped", "error"],
  running: ["stopping", "error"],
  stopping: ["stopped", "error"],
  error: ["stopped", "starting"], // Can retry
} as const;

export function isValidServiceStatusTransition(
  from: ServiceStatus,
  to: ServiceStatus
): boolean {
  return (
    (
      serviceStatusTransitions as Record<
        ServiceStatus,
        readonly ServiceStatus[]
      >
    )[from]?.includes(to) ?? false
  );
}

export const portRequestSchema = z.object({
  name: z.string(),
  preferred: z.number().int().min(1024).max(65_535).optional(),
  container: z.number().int().min(1).max(65_535).optional(),
  env: z.string().optional(),
});

export type PortRequest = z.infer<typeof portRequestSchema>;

export const envVarSchema = z.record(z.string(), z.string());

export type EnvVar = z.infer<typeof envVarSchema>;

const baseServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string().optional(),
  env: envVarSchema.optional(),
  ports: z.array(portRequestSchema).optional(),
  readyPattern: z.string().optional(),
});

export const processServiceSchema = baseServiceSchema.extend({
  type: z.literal("process").default("process"),
  setup: z.array(z.string()).optional(),
  run: z.string(),
  stop: z.string().optional(),
});

export type ProcessService = z.infer<typeof processServiceSchema>;

export const dockerServiceSchema = baseServiceSchema.extend({
  type: z.literal("docker"),
  image: z.string(),
  command: z.string().optional(),
  volumes: z.array(z.string()).optional(),
});

export type DockerService = z.infer<typeof dockerServiceSchema>;

export const composeServiceSchema = baseServiceSchema.extend({
  type: z.literal("compose"),
  composeFile: z.string(),
  services: z.array(z.string()).optional(),
});

export type ComposeService = z.infer<typeof composeServiceSchema>;

export const serviceSchema = z.discriminatedUnion("type", [
  processServiceSchema,
  dockerServiceSchema,
  composeServiceSchema,
]);

export type Service = z.infer<typeof serviceSchema>;

export const templateTypeSchema = z.enum([
  "implementation",
  "planning",
  "manual",
]);

export type TemplateType = z.infer<typeof templateTypeSchema>;

export const templateSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  type: templateTypeSchema.default("implementation"),
  prompts: z.array(z.string()).optional(),
  services: z.array(serviceSchema).optional(),
  teardown: z.array(z.string()).optional(),
  env: envVarSchema.optional(),
});

export type Template = z.infer<typeof templateSchema>;

export const opencodeConfigSchema = z.object({
  workspaceId: z.string(),
  token: z.string().optional(),
});

export type OpencodeConfig = z.infer<typeof opencodeConfigSchema>;

export const promptSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    order: z.number().int().optional(),
  }),
]);

export type PromptSource = z.infer<typeof promptSourceSchema>;

export const syntheticConfigSchema = z.object({
  opencode: opencodeConfigSchema,
  promptSources: z.array(promptSourceSchema).default([]),
  templates: z.array(templateSchema).default([]),
});

export type SyntheticConfig = z.infer<typeof syntheticConfigSchema>;

// Helper functions for TypeBox validation that use our unified enums
export function createConstructStatusUnion() {
  return constructStatusSchema.options;
}

export function createAgentStatusUnion() {
  return agentStatusSchema.options;
}

export function createServiceStatusUnion() {
  return serviceStatusSchema.options;
}
