import { z } from "zod";

/**
 * Port request configuration
 */
export const portRequestSchema = z.object({
  /** Unique name for this port (e.g., "api", "db") */
  name: z.string(),
  /** Preferred host port number (will try to allocate this first) */
  preferred: z.number().int().min(1024).max(65_535).optional(),
  /** Container port (for Docker services only) */
  container: z.number().int().min(1).max(65_535).optional(),
  /** Environment variable name to export the allocated port to */
  env: z.string().optional(),
});

export type PortRequest = z.infer<typeof portRequestSchema>;

/**
 * Environment variable configuration
 */
export const envVarSchema = z.record(z.string(), z.string());

export type EnvVar = z.infer<typeof envVarSchema>;

/**
 * Base service configuration
 */
const baseServiceSchema = z.object({
  /** Unique service identifier */
  id: z.string(),
  /** Human-readable service name */
  name: z.string(),
  /** Working directory for the service */
  cwd: z.string().optional(),
  /** Environment variables */
  env: envVarSchema.optional(),
  /** Port requests */
  ports: z.array(portRequestSchema).optional(),
  /** Regex pattern to detect service readiness */
  readyPattern: z.string().optional(),
});

/**
 * Process service configuration
 */
export const processServiceSchema = baseServiceSchema.extend({
  type: z.literal("process").default("process"),
  /** Setup commands to run before main command */
  setup: z.array(z.string()).optional(),
  /** Main command to run the service */
  run: z.string(),
  /** Optional stop command for graceful shutdown */
  stop: z.string().optional(),
});

export type ProcessService = z.infer<typeof processServiceSchema>;

/**
 * Docker service configuration
 */
export const dockerServiceSchema = baseServiceSchema.extend({
  type: z.literal("docker"),
  /** Docker image to use */
  image: z.string(),
  /** Optional command to override image default */
  command: z.string().optional(),
  /** Volume mounts */
  volumes: z.array(z.string()).optional(),
});

export type DockerService = z.infer<typeof dockerServiceSchema>;

/**
 * Docker Compose service configuration
 */
export const composeServiceSchema = baseServiceSchema.extend({
  type: z.literal("compose"),
  /** Path to docker-compose file */
  composeFile: z.string(),
  /** Optional service filter (to start specific services) */
  services: z.array(z.string()).optional(),
});

export type ComposeService = z.infer<typeof composeServiceSchema>;

/**
 * Union of all service types
 */
export const serviceSchema = z.discriminatedUnion("type", [
  processServiceSchema,
  dockerServiceSchema,
  composeServiceSchema,
]);

export type Service = z.infer<typeof serviceSchema>;

/**
 * Template type
 */
export const templateTypeSchema = z.enum([
  "implementation",
  "planning",
  "manual",
]);

export type TemplateType = z.infer<typeof templateTypeSchema>;

/**
 * Template configuration
 */
export const templateSchema = z.object({
  /** Unique template identifier */
  id: z.string(),
  /** Human-readable template name */
  label: z.string(),
  /** Brief description of template purpose */
  summary: z.string(),
  /** Template type (default: implementation) */
  type: templateTypeSchema.default("implementation"),
  /** Additional prompt files specific to this template */
  prompts: z.array(z.string()).optional(),
  /** Service definitions */
  services: z.array(serviceSchema).optional(),
  /** Teardown commands to run when construct stops */
  teardown: z.array(z.string()).optional(),
  /** Global environment variables inherited by all services */
  env: envVarSchema.optional(),
});

export type Template = z.infer<typeof templateSchema>;

/**
 * OpenCode workspace configuration
 */
export const opencodeConfigSchema = z.object({
  /** OpenCode workspace ID */
  workspaceId: z.string(),
  /** OpenCode authentication token (reference to env var) */
  token: z.string().optional(),
});

export type OpencodeConfig = z.infer<typeof opencodeConfigSchema>;

/**
 * Prompt source configuration
 * Can be a simple string path/glob, or an object with path and order
 */
export const promptSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    order: z.number().int().optional(),
  }),
]);

export type PromptSource = z.infer<typeof promptSourceSchema>;

/**
 * Complete workspace configuration
 */
export const syntheticConfigSchema = z.object({
  /** OpenCode workspace configuration */
  opencode: opencodeConfigSchema,
  /** Prompt source files/globs */
  promptSources: z.array(promptSourceSchema).default([]),
  /** Available construct templates */
  templates: z.array(templateSchema).default([]),
});

export type SyntheticConfig = z.infer<typeof syntheticConfigSchema>;
