# Template Definition System

- [x] Template Definition System #status/completed #phase-0 #feature/core

## Goal
Provide a flexible, type-safe system for defining construct templates that describe services, environments, and configuration.

## Implementation Status: ✅ **COMPLETED**

The template definition system has been successfully implemented using a **file-based configuration approach** rather than a database-driven system. This was an intentional architectural decision that prioritizes simplicity, developer experience, and version control.

### Key Implementation Decisions

**File-Based vs Database Storage:**
- **Chose file-based**: Templates are defined in `synthetic.config.ts` using TypeScript
- **Benefits**: 
  - Templates are version-controlled alongside code
  - Full TypeScript type safety and intellisense
  - No database migration overhead for template changes
  - Easy to share and distribute templates
  - Immediate availability without database setup
- **Trade-offs**: 
  - Dynamic template creation requires code changes (acceptable for v1)
  - No runtime template editing UI (planned for future phases)

**Frontend Integration:**
- Uses Elysia RPC with treaty for type-safe API communication
- Templates are loaded from config files at server startup
- No database dependencies for template management

## Requirements

### Template Schema
- **TypeScript definitions**: Ship a small runtime+types package (`@synthetic/config`) that exposes `defineSyntheticConfig` with full type safety and intellisense.
- **Inline templates**: Keep templates inline within `synthetic.config.ts` for v1 simplicity, with support for external template files in future versions.
- **Template metadata**: Each template requires `id`, `label`, `summary`, and optional `type` (implementation/planning/manual).
- **Workspace setup**: Templates can specify a `setup` array that runs once inside the worktree before services start.
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
- **Template setup**: Optional template-level `setup` array executed once after the worktree is provisioned and before any services start.
- **Ready detection**: Regex `readyPattern` matching against service output to determine when a service is ready.
- **Stop commands**: Optional stop commands for graceful service shutdown.
- **Teardown routines**: Template-level `teardown` array for cleanup commands when construct stops.

### Template Composition
- **Template inheritance**: Support for extending base templates (future enhancement).
- **Template composition**: Ability to combine multiple template fragments (future enhancement).
- **Conditional services**: Services that only start based on template variables or user input (future enhancement).

## UX Requirements

### Construct Creation Flow
- **Stepper/form**: Walk through type selection (implementation/planning/manual), template selection, task metadata (name, description, acceptance criteria), optional canned responses, and service adjustments (enable/disable, override ports/env where allowed). Show a short description for each type so the user understands whether an agent will be launched.
- **Template defaults**: Display template-provided defaults alongside editable fields, with inline hints pulled from template metadata (e.g., expected services, required env vars).
- **Summary review**: Show a summary review step confirming services that will start, initial prompt/context that will be sent to the agent, and any missing credentials/config that must be resolved before creation.
- **Autosave/draft**: Provide autosave/draft so long forms can be resumed, and validations that highlight missing fields before submission.

### Template Management Interface
- **Template browser**: Display available templates with descriptions, resource requirements, and compatibility information
- **Configuration validation**: Real-time validation with clear error messages for invalid template definitions
- **Preview functionality**: Show what services and resources will be created before confirming
- **Template editing**: Developer-friendly interface for creating and modifying templates

## Implementation Details

### Type System
- TypeScript interfaces for all template configuration objects
- Compile-time validation using TypeScript's type system
- Runtime validation for user-provided template data
- Intellisense support for template authors

### Variable Resolution
- Template variable parser and resolver
- Environment variable injection and substitution
- Path resolution for workspace-relative references
- Secret handling with secure variable expansion

### Service Management
- Unified interface for different service types
- Service lifecycle orchestration (setup, start, stop, teardown)
- Health check and ready detection mechanisms
- Port allocation and conflict resolution

## Integration Points
- **Construct Creation/Provisioning**: Uses template definitions for workspace and service setup
- **Agent Orchestration Engine**: Uses service definitions for provisioning
- **Prompt Assembly Pipeline**: Accesses template metadata for agent context
- **Service Control**: Provides runtime management of defined services
- **Docker & Compose Support**: Handles container-based service types
- **Configuration validation**: Built into template system for schema compliance and path validation

## Testing Strategy
- Test template validation and type safety
- Verify service lifecycle management for all service types
- Test port allocation and conflict resolution
- Validate variable resolution and environment injection
- Test template inheritance and composition features
- UX testing for template creation and management interfaces