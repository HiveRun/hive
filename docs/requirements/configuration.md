# Workspace & Template Configuration

This document covers the high-level concepts for workspace configuration. For detailed implementation specifications see the individual feature documents.

## Core Concepts

### Workspace Configuration
- Locate a `synthetic.config.ts` at the repo root exporting strongly typed workspace settings (one per project repository).
- Ship a small runtime+types package (`@synthetic/config`) that exposes `defineSyntheticConfig` for type-safe configuration.
- `opencode`: workspace ID and authentication token reference used by every construct session.
- `promptSources`: defines the reusable prompt fragments that Synthetic concatenates into agent prompts.
- `templates`: reusable construct templates that describe services, environments, and agent types.

### Configuration Features

The configuration system is implemented through these features:

- **[[features/template-definition-system|Template Definition System]]**: Provides the schema and type system for templates
- **[[features/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Manages prompt source resolution and assembly
- **[[features/configuration-validation|Configuration Validation]]**: Validates configuration before use

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
- **[[features/template-definition-system|Template Definition System]]**: Template schema, service definitions, and port management
- **[[features/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Source management, concatenation, and bundle building
- **[[features/configuration-validation|Configuration Validation]]**: CLI linting, type safety, and error handling
