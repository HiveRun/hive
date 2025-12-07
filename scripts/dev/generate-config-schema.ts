import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const stringArray = { type: "array", items: { type: "string" } } as const;
const stringRecord = {
  type: "object",
  additionalProperties: { type: "string" },
  required: [],
} as const;

const processServiceSchema = {
  type: "object",
  required: ["type", "run"],
  additionalProperties: false,
  properties: {
    type: { const: "process" },
    run: { type: "string" },
    setup: stringArray,
    cwd: { type: "string" },
    env: stringRecord,
    readyTimeoutMs: { type: "number" },
    stop: { type: "string" },
  },
} as const;

const dockerServiceSchema = {
  type: "object",
  required: ["type", "image"],
  additionalProperties: false,
  properties: {
    type: { const: "docker" },
    image: { type: "string" },
    command: { type: "string" },
    ports: stringArray,
    env: stringRecord,
    volumes: stringArray,
    readyTimeoutMs: { type: "number" },
  },
} as const;

const composeServiceSchema = {
  type: "object",
  required: ["type", "file"],
  additionalProperties: false,
  properties: {
    type: { const: "compose" },
    file: { type: "string" },
    services: stringArray,
    env: stringRecord,
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
    providerId: { type: "string" },
    modelId: { type: "string" },
    agentId: { type: "string" },
  },
} as const;

const templateSchema = {
  type: "object",
  required: ["id", "label", "type"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    type: { const: "manual" },
    services: { type: "object", additionalProperties: serviceSchema },
    env: stringRecord,
    setup: stringArray,
    prompts: stringArray,
    agent: templateAgentSchema,
    teardown: stringArray,
    includePatterns: stringArray,
    ignorePatterns: stringArray,
  },
} as const;

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "hive.config.schema.json",
  title: "HiveConfig",
  type: "object",
  additionalProperties: false,
  required: ["opencode", "promptSources", "templates"],
  properties: {
    opencode: {
      type: "object",
      required: ["defaultProvider"],
      additionalProperties: false,
      properties: {
        token: { type: "string" },
        defaultProvider: { type: "string" },
        defaultModel: { type: "string" },
      },
    },
    promptSources: stringArray,
    templates: {
      type: "object",
      additionalProperties: templateSchema,
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        templateId: { type: "string" },
      },
    },
  },
} as const;

const outputPath = resolve(process.cwd(), "hive.config.schema.json");
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Generated ${outputPath}`);
