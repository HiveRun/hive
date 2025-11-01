# Prompt Assembly Pipeline

## Goal
Provide a robust system for assembling agent prompts from multiple sources with proper ordering, validation, and context injection.

## Key Requirements

### Source Management
- **Prompt sources**: Read `promptSources` from `synthetic.config.ts`, supporting files, directories, or glob patterns (e.g., "docs/prompts/**/*.md").
- **Ordering support**: Allow entries to be objects with `path` and `order` so users can pin high-priority primers ahead of feature guides.
- **Type safety**: TypeScript definitions expose autocomplete for prompt source configuration.
- **Deduplication**: Automatic detection and removal of duplicate prompt fragments.

### Base Brief Assembly
- **Base template**: Store a repository-level Markdown template (`docs/agents/base-brief.md`) that explains Synthetic's purpose, construct concepts, guardrails, and escalation expectations.
- **Construct context injection**: When provisioning a construct, concatenate the base brief with:
  - Task summary and acceptance criteria from construct metadata
  - Tabular list of configured services with resolved hostnames/ports and exposed env vars
  - Template-level prompt fragments declared on the selected template
  - Explicit boundaries and safety reminders
  - Links or relative paths to important resources

### Template-Specific Prompts
- **Template prompts**: Allow templates to list additional `prompts` that reference files within the built bundle or absolute paths.
- **Domain-specific guidance**: Each construct instance can append domain-specific guidance automatically.
- **Prompt inheritance**: Support for template-level prompt inheritance from base templates (future enhancement).

### Bundle Generation
- **CLI integration**: Provide `synthetic prompts build` command that resolves configured sources through the TypeScript config.
- **Concatenation**: Deduplicate headings and concatenate fragments into `AGENTS.md` and other provider-specific outputs.
- **Rebuild triggers**: Rebuild prompt bundles during provisioning and whenever config changes.
- **Bundle metadata**: Expose generated bundle path in construct metadata for agent prompt assembly.

### Context Injection
- **Variable substitution**: Support template variable replacement in prompt fragments (e.g., `${constructId}`, `${workspaceName}`).
- **Service context**: Automatically inject service configuration (ports, URLs, environment) into prompts.
- **Dynamic content**: Include runtime information like current user, workspace settings, and construct state.
- **Safety boundaries**: Inject explicit boundaries and reminders about construct isolation.

### Validation & Optimization
- **Content validation**: Validate prompt fragments for required sections and formatting.
- **Token estimation**: Provide estimated token counts for assembled prompts.
- **Optimization suggestions**: Suggest prompt optimizations to reduce token usage while maintaining context.
- **Error handling**: Clear error messages for missing files, invalid syntax, or circular references.

## Integration Points
- **Agent Orchestration Engine**: Consumes assembled prompts for agent sessions
- **Template Definition System**: Accesses template-specific prompt configurations
- **Configuration Validation**: Validates prompt source paths and references
- **Planning-to-Implementation Handoff**: Provides planning vs implementation prompt variants
- **Prompt Optimisation**: Uses pipeline data for optimization analysis