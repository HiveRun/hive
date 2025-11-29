# Workspace & Template Configuration

This document covers the high-level concepts for workspace configuration. For detailed implementation specifications see the individual feature documents.

## Core Concepts

### Workspace Configuration
- Locate a `hive.config.ts` at the repo root exporting strongly typed workspace settings (one per project repository).
- Ship a small runtime+types package (`@hive/config`) that exposes `defineHiveConfig` for type-safe configuration.
- `opencode`: defines the workspace ID, optional token reference, and default provider/model used when launching agent sessions (`workspaceId`, `token`, `defaultProvider`, `defaultModel`). The repo defaults target the free `zen` provider with the `big-pickle` model, so no credentials are required out of the box. Developers can also drop an `opencode.json` file (or `@opencode.json`) inside the workspace root to provide personal defaults; that file takes effect only when templates omit an agent configuration.
- `promptSources`: defines the reusable prompt fragments that Hive concatenates into agent prompts.
- `templates`: reusable cell templates that describe services, environments, and agent types. Each template can now include an `agent` block `{ providerId, modelId? }` to override the global defaults.
- **Agent precedence**: When Hive spins up a cell, it uses the first available configuration in this order: user-selected provider/model, template `agent` block, workspace `opencode.json` default, then the repository-wide defaults in `hive.config.ts`.

### Configuration Features

The configuration system is implemented through these features:

- **[[features/phase-0/template-definition-system|Template Definition System]]**: Provides the schema and type system for templates
- **[[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Manages prompt source resolution and assembly

### Example Configuration
```ts
import { defineHiveConfig } from "@hive/config"

export default defineHiveConfig({
  opencode: { workspaceId: "workspace_123" },
  promptSources: ["docs/prompts/**/*.md"],
  templates: [
    {
      id: "full-stack-dev",
      label: "Full Stack Dev Sandbox",
      summary: "Boot a web client, API, and database for general feature work",
      type: "implementation", // or "planning" | "manual"
      prompts: ["docs/prompts/full-stack.md"],
      services: [/* ... */]
    }
  ]
})
```


## Related Features

For detailed implementation specifications, see:
- **[[features/phase-0/template-definition-system|Template Definition System]]**: Template schema, service definitions, and port management
- **[[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Source management, concatenation, and bundle building
