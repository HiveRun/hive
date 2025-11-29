# Cell Creation & Provisioning

- [d] Cell Creation & Provisioning #status/deferred #phase-0 #feature/advanced

> **Note**: This feature is **deferred** to focus on core functionality. See [[PR-SEQUENCE.md]] for current implementation path.
> 
> **Original Steps** (prepared but not implemented):
> - **Step 3**: Workspace & Cell Lifecycle → Now **Step 2: Basic Cell Management**
> - **Deferred**: Port Allocation System → Deferred to Phase 1A
> - **Deferred**: Service Management & Process Lifecycle → Deferred to Phase 1A  
> - **Deferred**: Provisioning Orchestration → Deferred to Phase 1A

## Goal
Handle the complete workflow of creating and provisioning cells from templates, including workspace setup, service initialization, and prompt assembly.

## Current Status: DEFERRED

This feature represents the **full provisioning orchestration** that was originally planned for Phase 0. It has been deferred to accelerate delivery of core functionality.

### What's Implemented Instead
- **Step 2**: Basic cell management (real database entities)
- **Step 3**: Git worktree integration (extends existing cells)
- **Step 4**: Agent integration (extends existing cells)

### When This Will Be Implemented
This comprehensive provisioning system will be implemented in **Phase 1A** after the core functionality path is complete and validated.

## Requirements

### Core Provisioning
- **Template Selection**: Allow users to browse and select from available cell templates defined in `hive.config.ts`
- **Workspace Provisioning**: Create isolated git worktrees for each cell to prevent conflicts with the main workspace
- **Service Setup**: Initialize and configure required services (databases, APIs, etc.) as specified by the template
- **Port Allocation**: Dynamically allocate and manage ports to avoid conflicts between cells and the host system
- **Prompt Assembly**: Compose the initial agent prompt from template fragments, task brief, and runtime context
- **Environment Configuration**: Set up environment variables, dependencies, and toolchain access for the cell

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
- Create git worktree in `.cells/<cell-id>/` using `git worktree add`
- Initialize cell-specific configuration files and directories
- Set up isolated node_modules, dependencies, and toolchain access
- Ensure proper permissions and ownership for the cell workspace

### Service Management
- Parse template service requirements and initialize accordingly
- Handle service dependencies and startup ordering
- Provide service health checks and status monitoring
- Manage service lifecycle (start, stop, restart) during cell operation

### Port Allocation Strategy
- Probe real host ports to avoid conflicts with running services
- Maintain port allocation registry to prevent duplicate assignments
- Support port ranges and specific port requirements from templates
- Handle port cleanup when cells are completed or archived

### Prompt Assembly Context
- Collect runtime information: allocated ports, service URLs, workspace paths
- Gather template-specific context and configuration
- Assemble base prompt with Hive overview and cell role
- Include task brief, constraints, and success criteria

## Integration Points
- **Template Definition System**: Provides template metadata and configuration schemas
- **Prompt Assembly Pipeline**: Handles the composition of agent prompts from multiple sources
- **Agent Orchestration Engine**: Receives the provisioned cell and assembled prompt for session initialization
- **Persistence Layer**: Stores cell metadata and provisioning state

## Testing Strategy
- Test template selection and validation workflows
- Verify workspace provisioning and isolation
- Test service initialization and health monitoring
- Validate port allocation and conflict resolution
- Test error handling and rollback mechanisms
- Performance testing for large repositories and complex templates

## Tasks
- [x] Surface template setup failures with detailed API/UI error context (2025-11-12)
- [x] Preserve failed cells and expose provisioning status for manual recovery (2025-11-12)
