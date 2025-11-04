// Import the helper directly from the server workspace for type-safe config
import { defineSyntheticConfig } from "./apps/server/src/lib/config";

/**
 * Example Synthetic workspace configuration.
 *
 * Copy this file to synthetic.config.ts and customize for your project.
 */
export default defineSyntheticConfig({
  opencode: {
    workspaceId: "your-workspace-id",
    token: process.env.OPENCODE_TOKEN,
  },

  promptSources: [
    // Base prompt with highest priority
    { path: "docs/prompts/base-brief.md", order: 0 },
    // Feature-specific prompts
    { path: "docs/prompts/**/*.md", order: 10 },
  ],

  templates: [
    {
      id: "full-stack-dev",
      label: "Full Stack Development",
      summary: "Complete development environment with web, API, and database",
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
          env: {
            NODE_ENV: "development",
          },
        },
        {
          type: "process",
          id: "server",
          name: "API Server",
          run: "bun run dev:server",
          ports: [{ name: "api", preferred: 3000, env: "API_PORT" }],
          readyPattern: "Server running",
        },
      ],
      env: {
        NODE_ENV: "development",
      },
    },
    {
      id: "planning",
      label: "Planning Session",
      summary: "Planning-mode agent for design and architecture work",
      type: "planning",
      prompts: ["docs/prompts/planning.md"],
    },
    {
      id: "manual",
      label: "Manual Workspace",
      summary: "Isolated workspace without agent assistance",
      type: "manual",
    },
  ],
});
