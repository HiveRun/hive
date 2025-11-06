import { describe, expect, it } from "vitest";
import {
  defineSyntheticConfig,
  syntheticConfigSchema,
  templateSchema,
} from "../../config/schema";

// Test input definitions
const INPUTS = {
  minimalTemplate: {
    id: "test-template",
    label: "Test Template",
    type: "manual" as const,
  },
  templateWithServices: {
    id: "web-app",
    label: "Web Application",
    type: "manual" as const,
    services: {
      api: {
        type: "process" as const,
        run: "bun run dev",
        cwd: "./api",
        env: { PORT: "3000" },
      },
    },
  },
  minimalConfig: {
    templates: {
      basic: {
        id: "basic",
        label: "Basic",
        type: "manual" as const,
      },
    },
  },
  configForValidation: {
    templates: {
      test: {
        id: "test",
        label: "Test",
        type: "manual",
      },
    },
  },
} as const;

// Expected output keys
const EXPECTED = {
  templateType: "manual",
  serviceType: "process",
  templateId: "test",
  configKey: "basic",
} as const;

describe("Template Schema", () => {
  it("should validate a minimal template", () => {
    const result = templateSchema.parse(INPUTS.minimalTemplate);
    expect(result.type).toBe(EXPECTED.templateType);
  });

  it("should validate a template with services", () => {
    const result = templateSchema.parse(INPUTS.templateWithServices);
    expect(result.services?.api?.type).toBe(EXPECTED.serviceType);
  });
});

describe("Synthetic Config Schema", () => {
  it("should validate a minimal config", () => {
    const result = syntheticConfigSchema.parse(INPUTS.minimalConfig);
    expect(result.templates[EXPECTED.configKey]).toBeDefined();
  });
});

describe("defineSyntheticConfig", () => {
  it("should return validated config", () => {
    const config = defineSyntheticConfig(INPUTS.configForValidation);
    expect(config.templates.test?.id).toBe(EXPECTED.templateId);
  });
});
