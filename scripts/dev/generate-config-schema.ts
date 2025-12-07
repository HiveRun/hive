import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { hiveConfigSchema } from "../../apps/server/src/config/schema";

const descriptionMap: Record<string, string> = {
  "": "Hive workspace configuration",
  $schema: "JSON schema reference",
  opencode: "Global OpenCode configuration shared across templates",
  "opencode/token": "Authentication token or environment reference",
  "opencode/defaultProvider":
    "Default provider identifier when templates omit one",
  "opencode/defaultModel":
    "Fallback model identifier used when templates omit one",
  promptSources:
    "Glob patterns pointing to prompt fragments used when assembling agent briefs",
  templates: "Available cell templates",
  "templates/*": "Template definition",
  "templates/*/id": "Unique template identifier",
  "templates/*/label": "Display name for template",
  "templates/*/type": "Template type",
  "templates/*/services": "Services required by this template",
  "templates/*/services/*": "Service definition",
  "templates/*/services/*/type": "Service type discriminator",
  "templates/*/services/*/run": "Command to run service",
  "templates/*/services/*/setup": "Setup commands before main command",
  "templates/*/services/*/cwd": "Working directory for service",
  "templates/*/services/*/env": "Environment variables",
  "templates/*/services/*/readyTimeoutMs":
    "Milliseconds to wait for service readiness",
  "templates/*/services/*/stop": "Graceful stop command",
  "templates/*/services/*/image": "Docker image to use",
  "templates/*/services/*/command": "Command to override default",
  "templates/*/services/*/ports": "Port mappings (e.g., '3000:3000')",
  "templates/*/services/*/volumes": "Volume mappings",
  "templates/*/services/*/file": "Path to docker-compose.yml",
  "templates/*/services/*/services": "Specific services to run",
  "templates/*/prompts":
    "Paths to prompt files or directories (relative to workspace root)",
  "templates/*/agent": "Agent configuration for this template",
  "templates/*/agent/providerId": "OpenCode provider identifier",
  "templates/*/agent/modelId": "Model identifier within the provider",
  "templates/*/agent/agentId": "Agent preset identifier",
  "templates/*/teardown": "Cleanup commands on cell stop",
  "templates/*/includePatterns":
    "Patterns to include from gitignored files for worktree copying (e.g., '.env', '*.local')",
  "templates/*/ignorePatterns":
    "Glob patterns to skip when copying included files into worktrees",
  defaults: "Default values for cell creation",
  "defaults/templateId": "Default template to use when creating cells",
};

type JsonSchemaNode = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const applyIfObject = (
  value: unknown,
  nextPath: string[],
  apply: (node: JsonSchemaNode, path: string[]) => void
) => {
  if (isObject(value)) {
    apply(value as JsonSchemaNode, nextPath);
  }
};

const applyToComposite = (
  list: unknown,
  path: string[],
  applyFn: (node: JsonSchemaNode, currentPath: string[]) => void
) => {
  if (!Array.isArray(list)) {
    return;
  }
  for (const child of list) {
    if (isObject(child)) {
      applyFn(child as JsonSchemaNode, path);
    }
  }
};

const applyDescriptions = (
  schema: JsonSchemaNode,
  path: string[] = []
): void => {
  const key = path.join("/");
  if (descriptionMap[key] && !schema.description) {
    schema.description = descriptionMap[key];
  }

  applyIfObject(schema.properties, path, (node, nextPath) => {
    for (const [prop, child] of Object.entries(
      node as Record<string, unknown>
    )) {
      applyDescriptions(child as JsonSchemaNode, [...nextPath, prop]);
    }
  });

  applyIfObject(schema.additionalProperties, [...path, "*"], applyDescriptions);
  applyIfObject(schema.items, [...path, "[]"], applyDescriptions);

  applyToComposite(schema.oneOf, path, applyDescriptions);
  applyToComposite(schema.anyOf, path, applyDescriptions);
  applyToComposite(schema.allOf, path, applyDescriptions);
};

const baseSchema = z.toJSONSchema(hiveConfigSchema, { target: "draft-7" });
applyDescriptions(baseSchema);

const hydratedSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "hive.config.schema.json",
  title: "HiveConfig",
  ...baseSchema,
  properties: {
    $schema: { type: "string", description: "JSON schema reference" },
    ...(baseSchema as { properties?: Record<string, unknown> }).properties,
  },
};

const outputPath = resolve(process.cwd(), "hive.config.schema.json");
await writeFile(
  outputPath,
  `${JSON.stringify(hydratedSchema, null, 2)}\n`,
  "utf8"
);

console.log(`Generated ${outputPath}`);
