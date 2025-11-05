import { defineSyntheticConfig } from "./apps/server/src/config/schema";

export default defineSyntheticConfig({
  templates: {
    "web-api": {
      id: "web-api",
      label: "Web API Server",
      summary: "REST API with database",
      type: "implementation",
      services: {
        api: {
          type: "process",
          run: "bun run dev",
          cwd: "./api",
          env: {
            PORT: "3000",
            NODE_ENV: "development",
          },
          readyPattern: "Server listening on",
        },
      },
      ports: [
        {
          name: "API_PORT",
          preferred: 3000,
        },
      ],
      prompts: ["docs/api-guidelines.md"],
    },
    planning: {
      id: "planning",
      label: "Planning Session",
      summary: "Plan and design new features",
      type: "planning",
    },
  },
  promptSources: [
    { path: "docs/prompts/base-brief.md", order: 1 },
    "docs/prompts/**/*.md",
  ],
});
