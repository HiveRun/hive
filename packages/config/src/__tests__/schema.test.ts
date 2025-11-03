import { describe, expect, it } from "vitest";
import {
  composeServiceSchema,
  dockerServiceSchema,
  portRequestSchema,
  processServiceSchema,
  serviceSchema,
  syntheticConfigSchema,
  templateSchema,
} from "../schema";

describe("portRequestSchema", () => {
  it("validates a basic port request", () => {
    const port = {
      name: "api",
      preferred: 3000,
    };
    expect(() => portRequestSchema.parse(port)).not.toThrow();
  });

  it("rejects invalid port numbers", () => {
    const port = {
      name: "api",
      preferred: 100, // Too low
    };
    expect(() => portRequestSchema.parse(port)).toThrow();
  });

  it("accepts optional container port", () => {
    const port = {
      name: "api",
      preferred: 3000,
      container: 8080,
      env: "API_PORT",
    };
    expect(() => portRequestSchema.parse(port)).not.toThrow();
  });
});

describe("processServiceSchema", () => {
  it("validates a basic process service", () => {
    const service = {
      type: "process",
      id: "web",
      name: "Web Server",
      run: "bun run dev",
    };
    expect(() => processServiceSchema.parse(service)).not.toThrow();
  });

  it("accepts optional setup commands", () => {
    const service = {
      type: "process",
      id: "api",
      name: "API Server",
      setup: ["bun install", "bun run build"],
      run: "bun run start",
      stop: "kill $PID",
    };
    expect(() => processServiceSchema.parse(service)).not.toThrow();
  });

  it("accepts ports and environment", () => {
    const service = {
      type: "process",
      id: "api",
      name: "API Server",
      run: "bun run start",
      ports: [{ name: "api", preferred: 3000, env: "API_PORT" }],
      env: { NODE_ENV: "development" },
      readyPattern: "Server running",
    };
    expect(() => processServiceSchema.parse(service)).not.toThrow();
  });
});

describe("dockerServiceSchema", () => {
  it("validates a basic docker service", () => {
    const service = {
      type: "docker",
      id: "postgres",
      name: "PostgreSQL",
      image: "postgres:16",
    };
    expect(() => dockerServiceSchema.parse(service)).not.toThrow();
  });

  it("accepts volumes and environment", () => {
    const service = {
      type: "docker",
      id: "postgres",
      name: "PostgreSQL",
      image: "postgres:16",
      volumes: ["./data:/var/lib/postgresql/data"],
      env: { POSTGRES_PASSWORD: "secret" },
      ports: [{ name: "db", preferred: 5432, container: 5432 }],
    };
    expect(() => dockerServiceSchema.parse(service)).not.toThrow();
  });
});

describe("composeServiceSchema", () => {
  it("validates a basic compose service", () => {
    const service = {
      type: "compose",
      id: "stack",
      name: "Full Stack",
      composeFile: "./docker-compose.yml",
    };
    expect(() => composeServiceSchema.parse(service)).not.toThrow();
  });

  it("accepts service filter", () => {
    const service = {
      type: "compose",
      id: "stack",
      name: "Full Stack",
      composeFile: "./docker-compose.yml",
      services: ["api", "db"],
    };
    expect(() => composeServiceSchema.parse(service)).not.toThrow();
  });
});

describe("serviceSchema", () => {
  it("discriminates between service types", () => {
    const processService = {
      type: "process",
      id: "web",
      name: "Web",
      run: "bun dev",
    };
    const dockerService = {
      type: "docker",
      id: "db",
      name: "Database",
      image: "postgres:16",
    };
    const composeService = {
      type: "compose",
      id: "stack",
      name: "Stack",
      composeFile: "./docker-compose.yml",
    };

    expect(() => serviceSchema.parse(processService)).not.toThrow();
    expect(() => serviceSchema.parse(dockerService)).not.toThrow();
    expect(() => serviceSchema.parse(composeService)).not.toThrow();
  });
});

describe("templateSchema", () => {
  it("validates a basic template", () => {
    const template = {
      id: "basic-dev",
      label: "Basic Development",
      summary: "A basic development environment",
    };
    expect(() => templateSchema.parse(template)).not.toThrow();
  });

  it("defaults type to implementation", () => {
    const template = {
      id: "basic-dev",
      label: "Basic Development",
      summary: "A basic development environment",
    };
    const parsed = templateSchema.parse(template);
    expect(parsed.type).toBe("implementation");
  });

  it("accepts all template types", () => {
    const types = ["implementation", "planning", "manual"] as const;
    for (const type of types) {
      const template = {
        id: "test",
        label: "Test",
        summary: "Test template",
        type,
      };
      expect(() => templateSchema.parse(template)).not.toThrow();
    }
  });

  it("accepts services and prompts", () => {
    const template = {
      id: "full-stack",
      label: "Full Stack",
      summary: "Full stack development environment",
      type: "implementation",
      prompts: ["docs/prompts/full-stack.md"],
      services: [
        {
          type: "process",
          id: "web",
          name: "Web Server",
          run: "bun run dev",
        },
      ],
      teardown: ["docker-compose down"],
      env: { NODE_ENV: "development" },
    };
    expect(() => templateSchema.parse(template)).not.toThrow();
  });
});

describe("syntheticConfigSchema", () => {
  it("validates a minimal config", () => {
    const config = {
      opencode: {
        workspaceId: "workspace_123",
      },
    };
    expect(() => syntheticConfigSchema.parse(config)).not.toThrow();
  });

  it("validates a complete config", () => {
    const config = {
      opencode: {
        workspaceId: "workspace_123",
        token: process.env.OPENCODE_TOKEN,
      },
      promptSources: [
        "docs/prompts/**/*.md",
        { path: "docs/base-brief.md", order: 0 },
      ],
      templates: [
        {
          id: "full-stack-dev",
          label: "Full Stack Development",
          summary: "Complete development environment",
          type: "implementation",
          prompts: ["docs/prompts/full-stack.md"],
          services: [
            {
              type: "process",
              id: "web",
              name: "Web Dev Server",
              run: "bun run dev:web",
              ports: [{ name: "web", preferred: 3001, env: "WEB_PORT" }],
              readyPattern: "Local:\\s+http://",
            },
            {
              type: "docker",
              id: "postgres",
              name: "PostgreSQL",
              image: "postgres:16",
              ports: [{ name: "db", preferred: 5432, container: 5432 }],
              env: { POSTGRES_PASSWORD: "secret" },
            },
          ],
          teardown: ["docker stop postgres"],
        },
      ],
    };
    expect(() => syntheticConfigSchema.parse(config)).not.toThrow();
  });

  it("defaults empty arrays for optional fields", () => {
    const config = {
      opencode: {
        workspaceId: "workspace_123",
      },
    };
    const parsed = syntheticConfigSchema.parse(config);
    expect(parsed.promptSources).toEqual([]);
    expect(parsed.templates).toEqual([]);
  });
});
