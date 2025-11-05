import { describe, expect, it } from "vitest";
import {
  defineSyntheticConfig,
  syntheticConfigSchema,
  templateSchema,
} from "../../config/schema";

describe("Template Schema", () => {
  it("should validate a minimal template", () => {
    const template = {
      id: "test-template",
      label: "Test Template",
      type: "manual" as const,
    };

    const result = templateSchema.parse(template);
    expect(result.type).toBe("manual");
  });

  it("should validate a template with services", () => {
    const template = {
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
    };

    const result = templateSchema.parse(template);
    expect(result.services?.api?.type).toBe("process");
  });

  it("should validate a template with port requests", () => {
    const template = {
      id: "api-server",
      label: "API Server",
      type: "manual" as const,
      ports: [{ name: "API_PORT" }, { name: "DB_PORT" }],
    };

    const result = templateSchema.parse(template);
    expect(result.ports).toHaveLength(2);
  });
});

describe("Synthetic Config Schema", () => {
  it("should validate a minimal config", () => {
    const config = {
      templates: {
        basic: {
          id: "basic",
          label: "Basic",
          type: "manual" as const,
        },
      },
    };

    const result = syntheticConfigSchema.parse(config);
    expect(result.templates.basic).toBeDefined();
  });
});

describe("defineSyntheticConfig", () => {
  it("should return validated config", () => {
    const config = defineSyntheticConfig({
      templates: {
        test: {
          id: "test",
          label: "Test",
          type: "manual",
        },
      },
    });

    expect(config.templates.test?.id).toBe("test");
  });
});
