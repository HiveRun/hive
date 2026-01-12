import { describe, expect, it } from "vitest";
import {
  defineHiveConfig,
  hiveConfigSchema,
  templateSchema,
} from "../../config/schema";

// Shared test data
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

// Expected output constants
const EXPECTED = {
  templateType: "manual",
  serviceType: "process",
  templateId: "test",
  configKey: "basic",
} as const;

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

  it("should accept agent configuration metadata", () => {
    const templateWithAgent = {
      id: "agent-template",
      label: "Agent Template",
      type: "manual" as const,
      agent: {
        providerId: "zen",
        modelId: "big-pickle",
      },
    };

    const result = templateSchema.parse(templateWithAgent);
    expect(result.agent?.providerId).toBe("zen");
  });
});

describe("Hive Config Schema", () => {
  it("should validate a minimal config", () => {
    const minimalConfig = {
      opencode: SAMPLE_OPENCODE_CONFIG,
      promptSources: ["docs/prompts/**/*.md"],
      templates: {
        basic: {
          id: "basic",
          label: "Basic",
          type: "manual" as const,
        },
      },
    };

    const result = hiveConfigSchema.parse(minimalConfig);
    expect(result.templates[EXPECTED.configKey]).toBeDefined();
    expect(result.opencode?.defaultProvider).toBe("zen");
  });

  it("should validate a config without opencode block", () => {
    const configWithoutOpencode = {
      promptSources: ["docs/prompts/**/*.md"],
      templates: {
        basic: {
          id: "basic",
          label: "Basic",
          type: "manual" as const,
        },
      },
    };

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
