# Service Control

- [x] Service Control #status/active #phase-1 #feature/infrastructure
  - [x] Split cell detail into dedicated `/cells/$id/chat` and `/cells/$id/services` routes linked from cell cards
  - [x] Add per-service start/stop controls with backend enforcement of unhealthy states
  - [x] [HIVE-19] Expose Effect layers for service orchestration and agent runtime adapters
  - [x] Replace the opt-in true E2E flow with Playwright (Chromium) for cell creation + chat send against isolated runtime DB/state
  - [x] Add Playwright workspace parity mode (`HIVE_E2E_WORKSPACE_MODE=clone`) to run against a cloned `hive` workspace while keeping isolated runtime state
  - [x] Add true runtime E2E coverage for service start/stop flows (single + bulk) and activity event assertions

## Goal
Provide comprehensive service management capabilities for both users and agents through UI, CLI, and MCP tools.

## Requirements

### Service State Management
- Record running service state (command, cwd, env, last-known status, pid if available).
- On startup, Hive should detect cells marked active, probe each recorded PID with `kill -0` (does not terminate the process) to see which services survived.
- Mark any missing processes as `needs_resume`. A cell's displayed status is derived from these state flags.
- If anything needs attention, the UI surfaces a "Resume cell" CTA (with optional granular controls).

### Service Control Interface
- Expose service control through both CLI/MCP tools (`list`, `stop`, `restart`, `resume`) so agents and humans can bounce services programmatically.
- Make it easy to copy the exact command/env that the supervisor uses (e.g., `hive services info <cell> <service>` prints the command) so users can run it manually if needed.
- Agent sessions should persist transcripts/context so a fresh OpenCode session can be created after restart.
- Present a "Resume agent" button that replays the composed prompt before sending any new user input.

### Service Monitoring
- Real-time service status tracking and updates
- Resource usage monitoring (CPU, memory, disk) for services
- Service health checks and readiness detection
- Log aggregation and access for troubleshooting

## UX Requirements

### Service Management UI
- **Service dashboard**: Clear overview of all services with status indicators
- **Individual service controls**: Start, stop, restart actions per service
- **Bulk operations**: Control multiple services simultaneously
- **Service details**: Detailed information about each service's configuration and state

### Status Visualization
- **Status indicators**: Visual representation of service health and state
- **Progress feedback**: Loading states during service operations
- **Error notifications**: Clear error messages and recovery suggestions
- **Resource displays**: CPU, memory, and disk usage graphs

### CLI/MCP Interface
- **Command consistency**: Uniform command structure across all service operations
- **Output formatting**: Human-readable and machine-parsable output formats
- **Help system**: Comprehensive help for all service control commands
- **Error handling**: Clear error messages and exit codes

## Implementation Details

### Current Progress (Service Supervisor)
- Template-defined process services are persisted per cell with command, cwd, env, PID, and status tracking
- Dynamic port discovery assigns unused ports per service and injects `{SERVICE}_PORT` plus shared port env vars across the cell
- Service metadata is stored in SQLite so the supervisor can restart services automatically on Hive boot and mark failures that need resume
- Worktree cleanup paths stop services and release reserved ports before tearing down cells to prevent orphaned processes
- Cell detail view now surfaces live service status plus recent log output (on a dedicated Services tab separate from the chat pane)

### Service State Engine
- Process monitoring and PID tracking
- Service lifecycle management
- State persistence and recovery
- Health check and readiness detection

### Control Interface
- CLI command structure and argument parsing
- MCP tool integration and protocol handling
- Service operation orchestration
- Error handling and rollback

### Monitoring System
- Resource usage collection and storage
- Service health monitoring
- Log aggregation and indexing
- Alert and notification system

## Integration Points
- **Agent Orchestration Engine**: Provides service status for agent session management
- **Cell Creation/Provisioning**: Integrates with service startup and initialization
- **Persistence Layer**: Stores service state and monitoring data
- **Docker & Compose Support**: Extends service control to containerized services

## Testing Strategy
- Test service lifecycle operations (start, stop, restart)
- Verify service state persistence and recovery
- Test CLI/MCP tool functionality and error handling
- Validate resource monitoring and health checks
- Test bulk operations and concurrent service management
- Performance testing with large numbers of services

## Testing Strategy
*This section needs to be filled in with specific testing approaches for service control functionality.*
