# Template Definition System

## Goal
Provide a flexible, type-safe system for defining construct templates that describe services, environments, and configuration.

## Key Requirements

### Template Schema
- **TypeScript definitions**: Ship a small runtime+types package (`@synthetic/config`) that exposes `defineSyntheticConfig` with full type safety and intellisense.
- **Inline templates**: Keep templates inline within `synthetic.config.ts` for v1 simplicity, with support for external template files in future versions.
- **Template metadata**: Each template requires `id`, `label`, `summary`, and optional `type` (implementation/planning/manual).
- **Validation**: Compile-time validation of template structure and required fields.

### Service Definitions
- **Service types**: Support `process` (default), `docker`, and `compose` service types with unified configuration interface.
- **Process services**: Define `run` command, optional `setup` commands, `cwd`, `env`, `readyPattern`, and `stop` command.
- **Docker services**: Specify `image`, optional `command`, `ports`, `env`, `volumes`, `readyPattern`, and deterministic container naming.
- **Compose services**: Point to compose file with optional service filter and variable injection.

### Port Management
- **Port requests**: Array of port requests with `name`, optional `preferred` host port, and optional `container` port for Docker.
- **Dynamic allocation**: Synthetic probes the actual OS for free ports (not just internal state) to avoid collisions.
- **Environment injection**: Resolved ports are exported as environment variables with configurable names via `env` field.
- **Template variables**: Support `${env.VAR_NAME}` and `${constructDir}` templating in service configurations.

### Environment & Variables
- **Environment variables**: Per-service environment configuration with support for static values and template variables.
- **Variable resolution**: Resolve template variables during provisioning (ports, construct paths, workspace settings).
- **Secret handling**: Safe handling of sensitive values through environment variable references.
- **Inheritance**: Global environment variables that all services inherit unless overridden.

### Lifecycle Management
- **Setup commands**: Optional setup commands that run before the main `run` command for each service.
- **Ready detection**: Regex `readyPattern` matching against service output to determine when a service is ready.
- **Stop commands**: Optional stop commands for graceful service shutdown.
- **Teardown routines**: Template-level `teardown` array for cleanup commands when construct stops.

### Template Composition
- **Template inheritance**: Support for extending base templates (future enhancement).
- **Template composition**: Ability to combine multiple template fragments (future enhancement).
- **Conditional services**: Services that only start based on template variables or user input (future enhancement).

## Integration Points
- **Agent Orchestration Engine**: Uses service definitions for provisioning
- **Prompt Assembly Pipeline**: Accesses template metadata for agent context
- **Service Control**: Provides runtime management of defined services
- **Docker & Compose Support**: Handles container-based service types
- **Configuration validation**: Built into template system for schema compliance and path validation

## UX Requirements

### Construct Creation Flow
- **Stepper/form**: Walk through type selection (implementation/planning/manual), template selection, task metadata (name, description, acceptance criteria), optional canned responses, and service adjustments (enable/disable, override ports/env where allowed). Show a short description for each type so the user understands whether an agent will be launched.
- **Template defaults**: Display template-provided defaults alongside editable fields, with inline hints pulled from template metadata (e.g., expected services, required env vars).
- **Summary review**: Show a summary review step confirming services that will start, initial prompt/context that will be sent to the agent, and any missing credentials/config that must be resolved before creation.
- **Autosave/draft**: Provide autosave/draft so long forms can be resumed, and validations that highlight missing fields before submission.