import { z } from "zod";

export const processServiceSchema = z.object({
  type: z.literal("process").default("process").describe("Service type"),
  run: z.string().describe("Command to run service"),
  setup: z
    .array(z.string())
    .optional()
    .describe("Setup commands to run before main command"),
  cwd: z.string().optional().describe("Working directory for service"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  readyTimeoutMs: z
    .number()
    .optional()
    .describe("Milliseconds to wait for service to be ready"),
  stop: z.string().optional().describe("Command to gracefully stop service"),
});

export const dockerServiceSchema = z.object({
  type: z.literal("docker").describe("Service type"),
  image: z.string().describe("Docker image to use"),
  command: z.string().optional().describe("Command to override default"),
  ports: z
    .array(z.string())
    .optional()
    .describe("Port mappings (e.g., '3000:3000')"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  volumes: z.array(z.string()).optional().describe("Volume mappings"),
  readyTimeoutMs: z
    .number()
    .optional()
    .describe("Milliseconds to wait for service to be ready"),
});

export const composeServiceSchema = z.object({
  type: z.literal("compose").describe("Service type"),
  file: z.string().describe("Path to docker-compose.yml"),
  services: z.array(z.string()).optional().describe("Specific services to run"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
});

export const serviceSchema = z
  .discriminatedUnion("type", [
    processServiceSchema,
    dockerServiceSchema,
    composeServiceSchema,
  ])
  .describe("Supported service definitions");

const templateAgentSchema = z.object({
  providerId: z.string().describe("OpenCode provider identifier"),
  modelId: z
    .string()
    .optional()
    .describe("Model identifier within the provider"),
  agentId: z.string().optional().describe("Agent preset identifier"),
});

export const templateSchema = z.object({
  id: z.string().describe("Unique template identifier"),
  label: z.string().describe("Display name for template"),
  type: z.literal("manual").describe("Template type"),
  services: z
    .record(z.string(), serviceSchema)
    .optional()
    .describe("Services required by this template"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Global environment variables"),
  setup: z
    .array(z.string())
    .optional()
    .describe("Commands to run once before starting template services"),
  prompts: z
    .array(z.string())
    .optional()
    .describe(
      "Paths to prompt files or directories (relative to workspace root)"
    ),
  agent: templateAgentSchema
    .optional()
    .describe("Agent configuration for this template"),
  teardown: z
    .array(z.string())
    .optional()
    .describe("Cleanup commands on cell stop"),
  includePatterns: z
    .array(z.string())
    .optional()
    .describe(
      "Patterns to include from gitignored files for worktree copying (e.g., '.env', '*.local')"
    ),
  ignorePatterns: z
    .array(z.string())
    .optional()
    .describe(
      "Glob patterns to skip when copying included files into worktrees"
    ),
});

const opencodeConfigSchema = z
  .object({
    token: z
      .string()
      .optional()
      .describe("Authentication token or environment reference for OpenCode"),
    defaultProvider: z
      .string()
      .min(1)
      .optional()
      .describe("Default provider identifier when templates omit one"),
    defaultModel: z
      .string()
      .optional()
      .describe("Fallback model identifier used when templates omit one"),
  })
  .describe("Global OpenCode configuration shared across templates");

export const defaultsSchema = z
  .object({
    templateId: z
      .string()
      .optional()
      .describe("Default template to use when creating cells"),
  })
  .describe("Default values for cell creation");

export const hiveConfigSchema = z
  .object({
    opencode: opencodeConfigSchema.optional(),
    promptSources: z
      .array(z.string())
      .default([])
      .describe(
        "Glob patterns pointing to prompt fragments used when assembling agent briefs"
      ),
    templates: z
      .record(z.string(), templateSchema)
      .describe("Available cell templates"),
    defaults: defaultsSchema.optional(),
  })
  .describe("Hive workspace configuration");

export type ProcessService = z.infer<typeof processServiceSchema>;
export type DockerService = z.infer<typeof dockerServiceSchema>;
export type ComposeService = z.infer<typeof composeServiceSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type TemplateAgent = z.infer<typeof templateAgentSchema>;
export type Template = z.infer<typeof templateSchema>;
export type OpencodeConfig = z.infer<typeof opencodeConfigSchema>;
export type Defaults = z.infer<typeof defaultsSchema>;
export type HiveConfig = z.infer<typeof hiveConfigSchema>;

export function defineHiveConfig(config: HiveConfig): HiveConfig {
  return hiveConfigSchema.parse(config);
}
