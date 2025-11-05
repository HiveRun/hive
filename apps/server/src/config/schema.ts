import { z } from "zod";

export const processServiceSchema = z.object({
  type: z.literal("process").default("process"),
  run: z.string().describe("Command to run the service"),
  setup: z
    .array(z.string())
    .optional()
    .describe("Setup commands to run before the main command"),
  cwd: z.string().optional().describe("Working directory for the service"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  readyPattern: z
    .string()
    .optional()
    .describe("Regex pattern to detect when service is ready"),
  stop: z
    .string()
    .optional()
    .describe("Command to gracefully stop the service"),
});

export const dockerServiceSchema = z.object({
  type: z.literal("docker"),
  image: z.string().describe("Docker image to use"),
  command: z.string().optional().describe("Command to override the default"),
  ports: z
    .array(z.string())
    .optional()
    .describe("Port mappings (e.g., '3000:3000')"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
  volumes: z.array(z.string()).optional().describe("Volume mappings"),
  readyPattern: z
    .string()
    .optional()
    .describe("Regex pattern to detect when service is ready"),
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

// Port request schema
export const portRequestSchema = z.object({
  name: z.string().describe("Environment variable name for the port"),
  preferred: z.number().optional().describe("Preferred port number"),
  container: z
    .number()
    .optional()
    .describe("Container port for Docker services"),
});

export const templateSchema = z.object({
  id: z.string().describe("Unique template identifier"),
  label: z.string().describe("Display name for the template"),
  summary: z.string().describe("Brief description of what this template does"),
  type: z
    .enum(["implementation", "planning", "manual"])
    .default("implementation"),
  services: z
    .record(z.string(), serviceSchema)
    .optional()
    .describe("Services required by this template"),
  ports: z.array(portRequestSchema).optional().describe("Ports to allocate"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Global environment variables"),
  prompts: z
    .array(z.string())
    .optional()
    .describe("Template-specific prompt fragments"),
  teardown: z
    .array(z.string())
    .optional()
    .describe("Cleanup commands on construct stop"),
});

export const syntheticConfigSchema = z.object({
  templates: z
    .record(z.string(), templateSchema)
    .describe("Available construct templates"),
  promptSources: z
    .array(
      z.union([
        z.string(),
        z.object({
          path: z.string(),
          order: z.number().optional(),
        }),
      ])
    )
    .optional()
    .describe("Global prompt sources (files, directories, or globs)"),
});

export type ProcessService = z.infer<typeof processServiceSchema>;
export type DockerService = z.infer<typeof dockerServiceSchema>;
export type ComposeService = z.infer<typeof composeServiceSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type PortRequest = z.infer<typeof portRequestSchema>;
export type Template = z.infer<typeof templateSchema>;
export type SyntheticConfig = z.infer<typeof syntheticConfigSchema>;

export function defineSyntheticConfig(
  config: SyntheticConfig
): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}
