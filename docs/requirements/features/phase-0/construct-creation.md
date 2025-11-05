# Construct Creation & Provisioning

- [ ] Construct Creation & Provisioning #status/planned #phase-0 #feature/core

> **Note**: This feature is split across multiple PRs:
> - **PR #3**: Workspace & Construct Lifecycle
> - **PR #4**: Port Allocation System  
> - **PR #5**: Service Management & Process Lifecycle
> - **PR #6**: Provisioning Orchestration

## Goal
Handle the complete workflow of creating and provisioning constructs from templates, including workspace setup, service initialization, and prompt assembly.

## Requirements

### Core Provisioning
- **Template Selection**: Allow users to browse and select from available construct templates defined in `synthetic.config.ts`
- **Workspace Provisioning**: Create isolated git worktrees for each construct to prevent conflicts with the main workspace
- **Service Setup**: Initialize and configure required services (databases, APIs, etc.) as specified by the template
- **Port Allocation**: Dynamically allocate and manage ports to avoid conflicts between constructs and the host system
- **Prompt Assembly**: Compose the initial agent prompt from template fragments, task brief, and runtime context
- **Environment Configuration**: Set up environment variables, dependencies, and toolchain access for the construct

## UX Requirements

### Template Selection Interface
- Display available templates with descriptions, requirements, and estimated resource usage
- Validate template compatibility with current workspace and user permissions
- Show template-specific configuration options (e.g., service choices, agent types)
- Provide clear feedback during template validation and selection process

### Provisioning Progress
- Show real-time progress during workspace creation and service initialization
- Display clear status indicators for each provisioning step
- Provide estimated completion times and current operation details
- Allow users to cancel provisioning operations with proper cleanup

### Error Feedback
- Surface provisioning errors with actionable guidance and recovery options
- Show specific failure points (template validation, workspace creation, service startup)
- Provide retry mechanisms for transient failures
- Display rollback status when provisioning fails and needs cleanup

## Implementation Details

### Template Selection Interface
- Display available templates with descriptions, requirements, and estimated resource usage
- Validate template compatibility with current workspace and user permissions
- Show template-specific configuration options (e.g., service choices, agent types)

### Workspace Provisioning
- Create git worktree in `.constructs/<construct-id>/` using `git worktree add`
- Initialize construct-specific configuration files and directories
- Set up isolated node_modules, dependencies, and toolchain access
- Ensure proper permissions and ownership for the construct workspace

### Service Management
- Parse template service requirements and initialize accordingly
- Handle service dependencies and startup ordering
- Provide service health checks and status monitoring
- Manage service lifecycle (start, stop, restart) during construct operation

### Port Allocation Strategy
- Probe real host ports to avoid conflicts with running services
- Maintain port allocation registry to prevent duplicate assignments
- Support port ranges and specific port requirements from templates
- Handle port cleanup when constructs are completed or archived

### Prompt Assembly Context
- Collect runtime information: allocated ports, service URLs, workspace paths
- Gather template-specific context and configuration
- Assemble base prompt with Synthetic overview and construct role
- Include task brief, constraints, and success criteria

## Integration Points
- **Template Definition System**: Provides template metadata and configuration schemas
- **Prompt Assembly Pipeline**: Handles the composition of agent prompts from multiple sources
- **Agent Orchestration Engine**: Receives the provisioned construct and assembled prompt for session initialization
- **Persistence Layer**: Stores construct metadata and provisioning state

## Testing Strategy
- Test template selection and validation workflows
- Verify workspace provisioning and isolation
- Test service initialization and health monitoring
- Validate port allocation and conflict resolution
- Test error handling and rollback mechanisms
- Performance testing for large repositories and complex templates