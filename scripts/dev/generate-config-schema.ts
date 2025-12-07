import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const stringArray = {
  type: "array",
  items: { type: "string" },
} as const;

const stringRecord = {
  type: "object",
  propertyNames: { type: "string" },
  additionalProperties: { type: "string" },
} as const;

const processServiceSchema = {
  type: "object",
  required: ["type", "run"],
  additionalProperties: false,
  properties: {
    type: {
      const: "process",
      type: "string",
      description: "Service type",
    },
    run: { type: "string", description: "Command to run service" },
    setup: {
      ...stringArray,
      description: "Setup commands before main command",
    },
    cwd: { type: "string", description: "Working directory for service" },
    env: { ...stringRecord, description: "Environment variables" },
    readyTimeoutMs: {
      type: "number",
      description: "Milliseconds to wait for service readiness",
    },
    stop: { type: "string", description: "Graceful stop command" },
  },
} as const;

const dockerServiceSchema = {
  type: "object",
  required: ["type", "image"],
  additionalProperties: false,
  properties: {
    type: { const: "docker", type: "string", description: "Service type" },
    image: { type: "string", description: "Docker image to use" },
    command: { type: "string", description: "Command to override default" },
    ports: { ...stringArray, description: "Port mappings (e.g., '3000:3000')" },
    env: { ...stringRecord, description: "Environment variables" },
    volumes: { ...stringArray, description: "Volume mappings" },
    readyTimeoutMs: {
      type: "number",
      description: "Milliseconds to wait for service readiness",
    },
  },
} as const;

const composeServiceSchema = {
  type: "object",
  required: ["type", "file"],
  additionalProperties: false,
  properties: {
    type: { const: "compose", type: "string", description: "Service type" },
    file: { type: "string", description: "Path to docker-compose.yml" },
    services: { ...stringArray, description: "Specific services to run" },
    env: { ...stringRecord, description: "Environment variables" },
  },
} as const;

const serviceSchema = {
  oneOf: [processServiceSchema, dockerServiceSchema, composeServiceSchema],
} as const;

const templateAgentSchema = {
  type: "object",
  required: ["providerId"],
  additionalProperties: false,
  properties: {
    providerId: { type: "string", description: "OpenCode provider identifier" },
    modelId: {
      type: "string",
      description: "Model identifier within the provider",
    },
    agentId: { type: "string", description: "Agent preset identifier" },
  },
} as const;

const templateSchema = {
  type: "object",
  required: ["id", "label", "type"],
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Unique template identifier" },
    label: { type: "string", description: "Display name for template" },
    type: { const: "manual", type: "string", description: "Template type" },
    services: {
      type: "object",
      propertyNames: { type: "string" },
      additionalProperties: serviceSchema,
      description: "Services required by this template",
    },
    env: { ...stringRecord, description: "Global environment variables" },
    setup: { ...stringArray, description: "Commands run once before services" },
    prompts: {
      ...stringArray,
      description: "Paths to prompt files or directories",
    },
    agent: { ...templateAgentSchema, description: "Agent configuration" },
    teardown: { ...stringArray, description: "Cleanup commands on cell stop" },
    includePatterns: {
      ...stringArray,
      description:
        "Glob patterns to include from gitignored files for worktree copying",
    },
    ignorePatterns: {
      ...stringArray,
      description: "Glob patterns to skip when copying into worktrees",
    },
  },
} as const;

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "hive.config.schema.json",
  title: "HiveConfig",
  type: "object",
  properties: {
    $schema: { type: "string", description: "JSON schema reference" },
    opencode: {
      type: "object",
      required: ["defaultProvider"],
      additionalProperties: false,
      description: "Global OpenCode configuration shared across templates",
      properties: {
        token: {
          type: "string",
          description: "Authentication token or environment reference",
        },
        defaultProvider: {
          type: "string",
          minLength: 1,
          description: "Default provider identifier when templates omit one",
          default: "openai",
        },
        defaultModel: {
          type: "string",
          description: "Fallback model identifier when templates omit one",
        },
      },
    },
    promptSources: {
      ...stringArray,
      description:
        "Glob patterns pointing to prompt fragments used when assembling agent briefs",
      default: [],
    },
    templates: {
      type: "object",
      propertyNames: { type: "string" },
      additionalProperties: templateSchema,
      description: "Available cell templates",
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      description: "Default values for cell creation",
      properties: {
        templateId: {
          type: "string",
          description: "Default template to use when creating cells",
        },
      },
    },
  },
  required: ["opencode", "promptSources", "templates"],
  additionalProperties: false,
} as const;

const outputPath = resolve(process.cwd(), "hive.config.schema.json");
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Generated ${outputPath}`);
