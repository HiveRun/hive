# Prompt Assembly Pipeline

- [d] Prompt Assembly Pipeline #status/deferred #phase-0 #feature/advanced

## Goal
Provide a robust system for assembling agent prompts from multiple sources with proper ordering, validation, and context injection.

## Current Status: DEFERRED

This feature represents **advanced prompt management** that was originally planned for Phase 0. It has been deferred to accelerate delivery of core functionality.

### What's Implemented Instead
- **PR #4**: Basic agent integration with simple prompt handling
- Templates provide basic context without complex assembly

### When This Will Be Implemented
This sophisticated prompt assembly system will be implemented in **Phase 1A** after core functionality path is complete and validated.

## Requirements

### Source Management
- **Prompt sources**: Read `promptSources` from `hive.config.ts`, supporting files, directories, or glob patterns (e.g., "docs/prompts/**/*.md").
- **Ordering support**: Allow entries to be objects with `path` and `order` so users can pin high-priority primers ahead of feature guides.
- **Type safety**: TypeScript definitions expose autocomplete for prompt source configuration.
- **Deduplication**: Automatic detection and removal of duplicate prompt fragments.

### Base Brief Assembly
- **Base template**: Store a repository-level Markdown template (`docs/agents/base-brief.md`) that explains Hive's purpose, construct concepts, guardrails, and escalation expectations.
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
- **CLI integration**: Provide `hive prompts build` command that resolves configured sources through the TypeScript config.
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

## UX Requirements

### Prompt Management Interface
- **Source browser**: Display available prompt sources with their order and content preview
- **Bundle preview**: Show assembled prompt bundles before they're sent to agents
- **Token usage display**: Real-time token count and cost estimates for assembled prompts
- **Validation feedback**: Clear error messages and warnings for prompt configuration issues

### Configuration UI
- **Visual ordering**: Drag-and-drop interface for arranging prompt sources
- **Template variable editor**: Interface for defining and previewing template variables
- **Context injection preview**: Show how runtime context will be injected into prompts
- **Optimization suggestions**: UI for applying prompt optimization recommendations

## Implementation Details

### Source Resolution
- Glob pattern matching and file discovery
- Path resolution for relative and absolute references
- Content deduplication and merging logic
- Order validation and conflict resolution

### Variable System
- Template variable parser and resolver
- Context injection engine for runtime data
- Variable validation and type checking
- Circular reference detection

### Bundle Assembly
- Markdown concatenation with heading deduplication
- Content validation and formatting checks
- Token counting and cost estimation
- Bundle metadata generation

## Integration Points
- **Agent Orchestration Engine**: Consumes assembled prompts for agent sessions
- **Construct Creation/Provisioning**: Provides construct context for prompt assembly
- **Template Definition System**: Accesses template-specific prompt configurations
- **Planning-to-Implementation Handoff**: Provides planning vs implementation prompt variants
- **Prompt Optimisation**: Uses pipeline data for optimization analysis
- **Configuration validation**: Built into pipeline for source path validation and error handling

## Testing Strategy
- Test prompt source resolution and ordering
- Verify variable substitution and context injection
- Test bundle generation and validation
- Validate token estimation accuracy
- Test error handling for invalid configurations
- Performance testing for large prompt assemblies