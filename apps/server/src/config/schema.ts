import { z } from "zod";
import { collectServiceGraphIssues } from "./service-graph";

const MAX_TCP_PORT = 65_535;

const servicePortNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Port names may only contain letters, numbers, underscores, and hyphens"
  );

const serviceNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Service names may only contain letters, numbers, underscores, and hyphens"
  );

const processServicePortsSchema = z
  .record(
    servicePortNameSchema,
    z.object({
      port: z
        .number()
        .int()
        .min(1)
        .max(MAX_TCP_PORT)
        .optional()
        .describe("Bind this exact host port instead of allocating one"),
      primary: z.boolean().optional().describe("Use as the compatibility port"),
      protocol: z
        .enum(["http", "https", "tcp"])
        .optional()
        .describe("How clients should connect to the port (defaults to http)"),
      viewer: z
        .boolean()
        .optional()
        .describe(
          "Show this HTTP or HTTPS port in the browser viewer (defaults to true)"
        ),
    })
  )
  .refine((ports) => Object.keys(ports).length > 0, {
    message: "ports must define at least one named port",
  })
  .refine(
    (ports) =>
      Object.values(ports).filter((port) => port.primary === true).length === 1,
    { message: "ports must mark exactly one port as primary" }
  );

const readinessCommonSchema = {
  port: servicePortNameSchema.describe("Named service port to probe"),
  host: z
    .string()
    .min(1)
    .optional()
    .describe("Probe host (defaults to 127.0.0.1)"),
};

const processReadinessCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tcp"),
    ...readinessCommonSchema,
  }),
  z.object({
    type: z.literal("http"),
    ...readinessCommonSchema,
    path: z
      .string()
      .startsWith("/")
      .optional()
      .describe("HTTP path to probe (defaults to /)"),
    method: z.enum(["GET", "HEAD"]).optional(),
    protocol: z.enum(["http", "https"]).optional(),
  }),
]);

const processReadinessSchema = z.object({
  checks: z
    .array(processReadinessCheckSchema)
    .min(1)
    .describe("Checks that must all pass before the service is ready"),
  intervalMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Milliseconds between readiness attempts"),
});

const processServiceSchema = z.object({
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
  ports: processServicePortsSchema
    .optional()
    .describe("Named ports allocated for the service"),
  dependsOn: z
    .array(z.string().min(1))
    .optional()
    .describe("Services that must be ready before this service starts"),
  readiness: processReadinessSchema
    .optional()
    .describe("Readiness probe run after process spawn"),
  readyTimeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Readiness deadline in milliseconds"),
  stop: z.string().optional().describe("Command to gracefully stop service"),
});

const dockerServiceSchema = z.object({
  type: z
    .literal("docker")
    .describe("Reserved service type; execution is not implemented"),
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

const composeServiceSchema = z.object({
  type: z
    .literal("compose")
    .describe("Reserved service type; execution is not implemented"),
  file: z.string().describe("Path to docker-compose.yml"),
  services: z.array(z.string()).optional().describe("Specific services to run"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables"),
});

const serviceSchema = z
  .discriminatedUnion("type", [
    processServiceSchema,
    dockerServiceSchema,
    composeServiceSchema,
  ])
  .describe("Service definitions; only process services are executable");

const templateAgentModelSchema = z.object({
  providerId: z.string().describe("OpenCode provider identifier"),
  id: z.string().describe("Model identifier within the provider"),
  variant: z.string().optional().describe("Optional model variant identifier"),
});

const templateAgentSchema = z.object({
  model: templateAgentModelSchema
    .optional()
    .describe("Model configuration for this template"),
  providerId: z
    .string()
    .optional()
    .describe("Deprecated: OpenCode provider identifier"),
  modelId: z
    .string()
    .optional()
    .describe("Deprecated: model identifier within the provider"),
  variant: z
    .string()
    .optional()
    .describe("Deprecated: model variant identifier"),
  agentId: z.string().optional().describe("Agent preset identifier"),
});

export const templateSchema = z
  .object({
    id: z.string().describe("Unique template identifier"),
    label: z.string().describe("Display name for template"),
    type: z.literal("manual").describe("Template type"),
    services: z
      .record(serviceNameSchema, serviceSchema)
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
      .describe("Cleanup commands on cell deletion or provisioning rollback"),
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
  })
  .superRefine((template, context) => {
    const services = (template.services ?? {}) as Parameters<
      typeof collectServiceGraphIssues
    >[0];
    for (const issue of collectServiceGraphIssues(services)) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
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
    defaultMode: z
      .enum(["plan", "build"])
      .optional()
      .describe("Default OpenCode agent mode when creating new cells"),
  })
  .describe("Global OpenCode configuration shared across templates");

const defaultsSchema = z
  .object({
    templateId: z
      .string()
      .optional()
      .describe("Default template to use when creating cells"),
    startMode: z
      .enum(["plan", "build"])
      .optional()
      .describe("Default OpenCode agent mode for new cells"),
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
export type Service = z.infer<typeof serviceSchema>;
export type Template = z.infer<typeof templateSchema>;
export type HiveConfig = z.infer<typeof hiveConfigSchema>;

export function defineHiveConfig(config: HiveConfig): HiveConfig {
  return hiveConfigSchema.parse(config);
}
