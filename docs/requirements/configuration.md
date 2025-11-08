# Workspace & Template Configuration

This document covers the high-level concepts for workspace configuration. For detailed implementation specifications see the individual feature documents.

## Core Concepts

### Workspace Configuration
- Locate a `synthetic.config.ts` at the repo root exporting strongly typed workspace settings (one per project repository).
- Ship a small runtime+types package (`@synthetic/config`) that exposes `defineSyntheticConfig` for type-safe configuration.
- `opencode`: defines the workspace ID, optional token reference, and default provider/model used when launching agent sessions (`workspaceId`, `token`, `defaultProvider`, `defaultModel`).
- `promptSources`: defines the reusable prompt fragments that Synthetic concatenates into agent prompts.
- `templates`: reusable construct templates that describe services, environments, and agent types. Each template can now include an `agent` block `{ providerId, modelId? }` to override the global defaults.

### Configuration Features

The configuration system is implemented through these features:

- **[[features/phase-0/template-definition-system|Template Definition System]]**: Provides the schema and type system for templates
- **[[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Manages prompt source resolution and assembly

### Example Configuration
```ts
import { defineSyntheticConfig } from "@synthetic/config"

export default defineSyntheticConfig({
  opencode: { workspaceId: "workspace_123", token: process.env.OPENCODE_TOKEN },
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
