import { describe, expect, it } from "vitest";
import {
  defineSyntheticConfig,
  syntheticConfigSchema,
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

const BASE_URL_ERROR_REGEX = /baseUrl/;

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

describe("Synthetic Config Schema", () => {
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

    const result = syntheticConfigSchema.parse(minimalConfig);
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
          provider: "openai" as const,
          model: "whisper-1",
          baseUrl: "http://localhost:11434/v1",
          language: "en",
        },
      },
    };

    const result = syntheticConfigSchema.parse(configWithVoice);
    expect(result.voice?.enabled).toBe(true);
    expect(result.voice?.transcription.mode).toBe("local");
    expect(result.voice?.transcription.baseUrl).toBe(
      "http://localhost:11434/v1"
    );
  });

  it("should reject local transcription config without baseUrl", () => {
    const invalidVoiceConfig = {
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
          provider: "openai" as const,
          model: "whisper-1",
        },
      },
    } as const;

    expect(() => syntheticConfigSchema.parse(invalidVoiceConfig)).toThrow(
      BASE_URL_ERROR_REGEX
    );
  });
});

describe("defineSyntheticConfig", () => {
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

    const config = defineSyntheticConfig(configForValidation);
    expect(config.templates.test?.id).toBe(EXPECTED.templateId);
    expect(config.opencode.defaultProvider).toBe("zen");
  });
});
