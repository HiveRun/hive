import { z } from "zod";

export const processServiceSchema = z.object({
  type: z.literal("process").default("process"),
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
  type: z.literal("docker"),
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
  type: z.literal("compose"),
  file: z.string().describe("Path to docker-compose.yml"),
  services: z.array(z.string()).optional().describe("Specific services to run"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
});

export const serviceSchema = z.discriminatedUnion("type", [
  processServiceSchema,
  dockerServiceSchema,
  composeServiceSchema,
]);

export const templateSchema = z.object({
  id: z.string().describe("Unique template identifier"),
  label: z.string().describe("Display name for template"),
  type: z.literal("manual"),
  services: z
    .record(z.string(), serviceSchema)
    .optional()
    .describe("Services required by this template"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Global environment variables"),
  prompts: z
    .array(z.string())
    .optional()
    .describe(
      "Paths to prompt files or directories (relative to workspace root)"
    ),
  teardown: z
    .array(z.string())
    .optional()
    .describe("Cleanup commands on construct stop"),
});

export const syntheticConfigSchema = z.object({
  templates: z
    .record(z.string(), templateSchema)
    .describe("Available construct templates"),
});

export type ProcessService = z.infer<typeof processServiceSchema>;
export type DockerService = z.infer<typeof dockerServiceSchema>;
export type ComposeService = z.infer<typeof composeServiceSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Template = z.infer<typeof templateSchema>;
export type SyntheticConfig = z.infer<typeof syntheticConfigSchema>;

export function defineSyntheticConfig(
  config: SyntheticConfig
): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}
