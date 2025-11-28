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
    expect(result.opencode.defaultProvider).toBe("zen");
  });

  it("should accept a local transcription configuration", () => {
    const configWithVoice = {
      opencode: SAMPLE_OPENCODE_CONFIG,
      promptSources: [],
      templates: {
        basic: {
          id: "basic",
          label: "Basic",
          type: "manual" as const,
        },
      },
      voice: {
        enabled: true,
        transcription: {
          mode: "local" as const,
          model: "Xenova/whisper-small",
          language: "en",
        },
      },
    };

    const result = hiveConfigSchema.parse(configWithVoice);
    expect(result.voice?.enabled).toBe(true);
    const transcription = result.voice?.transcription;
    expect(transcription?.mode).toBe("local");
    if (transcription?.mode !== "local") {
      throw new Error("Expected local transcription configuration");
    }
    expect(transcription.model).toBe("Xenova/whisper-small");
    expect(transcription.provider).toBe("local");
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
    expect(config.opencode.defaultProvider).toBe("zen");
  });
});
