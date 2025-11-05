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
      summary: "A test template",
    };

    const result = templateSchema.parse(template);
    expect(result.type).toBe("implementation");
  });

  it("should validate a template with services", () => {
    const template = {
      id: "web-app",
      label: "Web Application",
      summary: "A web app with database",
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
      summary: "REST API",
      ports: [
        { name: "API_PORT", preferred: 3000 },
        { name: "DB_PORT", preferred: 5432 },
      ],
    };

    const result = templateSchema.parse(template);
    expect(result.ports).toHaveLength(2);
  });

  it("should reject invalid template type", () => {
    const template = {
      id: "invalid",
      label: "Invalid",
      summary: "Invalid type",
      type: "invalid-type",
    };

    expect(() => templateSchema.parse(template)).toThrow();
  });
});

describe("Synthetic Config Schema", () => {
  it("should validate a minimal config", () => {
    const config = {
      templates: {
        basic: {
          id: "basic",
          label: "Basic",
          summary: "Basic template",
          type: "implementation" as const,
        },
      },
    };

    const result = syntheticConfigSchema.parse(config);
    expect(result.templates.basic).toBeDefined();
  });

  it("should validate config with prompt sources", () => {
    const config = {
      templates: {},
      promptSources: ["docs/prompts/**/*.md", { path: "README.md", order: 1 }],
    };

    const result = syntheticConfigSchema.parse(config);
    expect(result.promptSources).toHaveLength(2);
  });
});

describe("defineSyntheticConfig", () => {
  it("should return validated config", () => {
    const config = defineSyntheticConfig({
      templates: {
        test: {
          id: "test",
          label: "Test",
          summary: "Test template",
          type: "implementation",
        },
      },
    });

    expect(config.templates.test?.id).toBe("test");
  });

  it("should throw on invalid config", () => {
    expect(() =>
      defineSyntheticConfig({
        templates: {
          // @ts-expect-error Testing invalid config
          invalid: {
            id: "test",
          },
        },
      })
    ).toThrow();
  });
});
