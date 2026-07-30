import { describe, expect, it } from "vitest";
import {
  defineHiveConfig,
  hiveConfigSchema,
  type ProcessService,
  type Template,
  templateSchema,
} from "../../config/schema";

const SHARED_INPUTS = {
  commonServiceConfig: {
    type: "process" as const,
    run: "bun run dev",
    env: { NODE_ENV: "development" },
  },
} as const;

const SAMPLE_OPENCODE_CONFIG = {
  defaultProvider: "zen",
  defaultModel: "big-pickle",
} as const;

const EXPECTED = {
  templateType: "manual",
  serviceType: "process",
  templateId: "test",
  configKey: "basic",
} as const;

const createMinimalConfig = (includeOpencode: boolean) => ({
  ...(includeOpencode ? { opencode: SAMPLE_OPENCODE_CONFIG } : {}),
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    basic: {
      id: "basic",
      label: "Basic",
      type: "manual" as const,
    },
  },
});

const processService = (
  overrides: Partial<Omit<ProcessService, "type">> = {}
): ProcessService => ({ type: "process", run: "bun run dev", ...overrides });

const template = (
  overrides: Partial<Omit<Template, "id" | "label" | "type">> = {}
): Template => ({
  id: "services",
  label: "Services",
  type: "manual",
  ...overrides,
});

describe("Template Schema", () => {
  it("should validate a minimal template", () => {
    const minimalTemplate = {
      id: "test-template",
      label: "Test Template",
      type: "manual" as const,
    };

    const result = templateSchema.parse(minimalTemplate);
    expect(result.type).toBe(EXPECTED.templateType);
  });

  it("should validate a template with services", () => {
    const templateWithServices = {
      id: "web-app",
      label: "Web Application",
      type: "manual" as const,
      services: {
        api: {
          ...SHARED_INPUTS.commonServiceConfig,
          cwd: "./api",
          env: { ...SHARED_INPUTS.commonServiceConfig.env, PORT: "3000" },
        },
      },
    };

    const result = templateSchema.parse(templateWithServices);
    expect(result.services?.api?.type).toBe(EXPECTED.serviceType);
  });

  it("validates named ports, dependencies, and readiness references", () => {
    const result = templateSchema.parse(
      template({
        services: {
          api: processService({
            run: "bun run api",
            ports: {
              http: { primary: true },
              metrics: { protocol: "tcp" },
            },
            dependsOn: ["db"],
            readiness: {
              checks: [
                {
                  type: "http",
                  port: "http",
                  path: "/health",
                },
                { type: "tcp", port: "metrics" },
              ],
              intervalMs: 25,
            },
            readyTimeoutMs: 2000,
          }),
          db: processService({ run: "bun run db" }),
        },
      })
    );

    expect(result.services?.api).toMatchObject({
      dependsOn: ["db"],
      ports: { http: { primary: true }, metrics: { protocol: "tcp" } },
      readiness: {
        checks: [
          { type: "http", port: "http" },
          { type: "tcp", port: "metrics" },
        ],
      },
    });
  });

  it("surfaces service graph validation issues", () => {
    const result = templateSchema.safeParse(
      template({
        services: {
          api: processService({
            ports: { http: { primary: true } },
            readiness: { checks: [{ type: "tcp", port: "metrics" }] },
          }),
        },
      })
    );
    const invalidName = templateSchema.safeParse(
      template({ services: { "api.v1": processService() } })
    );

    expect(result.success).toBe(false);
    expect(invalidName.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map((issue) => issue.message).join("\n")
      ).toContain('readiness references unknown port "metrics"');
    }
  });

  it("should accept agent configuration metadata", () => {
    const templateWithAgent = {
      id: "agent-template",
      label: "Agent Template",
      type: "manual" as const,
      agent: {
        model: {
          providerId: "zen",
          id: "big-pickle",
          variant: "high",
        },
      },
    };

    const result = templateSchema.parse(templateWithAgent);
    expect(result.agent?.model?.providerId).toBe("zen");
    expect(result.agent?.model?.variant).toBe("high");
  });

  it("should keep supporting deprecated flat agent model keys", () => {
    const templateWithLegacyAgent = {
      id: "legacy-agent-template",
      label: "Legacy Agent Template",
      type: "manual" as const,
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
        variant: "high",
      },
    };

    const result = templateSchema.parse(templateWithLegacyAgent);
    expect(result.agent?.providerId).toBe("zen");
    expect(result.agent?.variant).toBe("high");
  });
});

describe("Hive Config Schema", () => {
  it("should validate a minimal config", () => {
    const minimalConfig = createMinimalConfig(true);

    const result = hiveConfigSchema.parse(minimalConfig);
    expect(result.templates[EXPECTED.configKey]).toBeDefined();
    expect(result.opencode?.defaultProvider).toBe("zen");
  });

  it("should validate a config without opencode block", () => {
    const configWithoutOpencode = createMinimalConfig(false);

    const result = hiveConfigSchema.parse(configWithoutOpencode);
    expect(result.templates.basic).toBeDefined();
    expect(result.opencode).toBeUndefined();
  });
});

describe("defineHiveConfig", () => {
  it("should return validated config", () => {
    const configForValidation = {
      opencode: SAMPLE_OPENCODE_CONFIG,
      promptSources: [],
      templates: {
        test: {
          id: "test",
          label: "Test",
          type: "manual" as const,
        },
      },
    };

    const config = defineHiveConfig(configForValidation);
    expect(config.templates.test?.id).toBe(EXPECTED.templateId);
    expect(config.opencode?.defaultProvider).toBe("zen");
  });
});
