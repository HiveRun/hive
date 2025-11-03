import { z } from "zod";

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
