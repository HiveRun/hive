# Sparse Cells

- [ ] Sparse Cells #status/planned #phase-2 #feature/advanced

## Goal
Allow launching cells that run an agent without provisioning the full service stack, useful for lightweight planning or research tasks.

## Requirements

### Core Sparse Functionality
- Skip service provisioning while still creating an isolated worktree.
- Clarify limitations in the UI (no live backend/frontend services available).
- Permit later conversion into a full cell (provision services and resume implementation).
- Ensure diff/prompt workflows still function in sparse mode.

### Agent-Only Mode
- **Lightweight setup**: Minimal initialization for agent-only operation
- **Resource efficiency**: Low resource usage without service overhead
- **Fast startup**: Quick cell creation without service provisioning delays
- **Isolated workspace**: Still maintain worktree isolation for safety

### Conversion Capabilities
- **Upgrade path**: Convert sparse cells to full cells with service provisioning
- **Service addition**: Add services to existing sparse cells
- **State preservation**: Maintain agent context and history during conversion
- **Flexible workflow**: Allow switching between sparse and full modes

## UX Requirements

### Sparse Cell Creation
- **Mode selection**: Clear option to create sparse vs full cells
- **Limitation disclosure**: Explicit UI indicators of sparse mode limitations
- **Quick creation**: Streamlined creation flow without service configuration
- **Conversion prompts**: Easy upgrade path when services are needed

### Interface Adaptations
- **Simplified dashboard**: Hide service-related UI elements in sparse mode
- **Agent focus**: Emphasize agent interaction in sparse cells
- **Status indicators**: Clear indication of sparse vs full cell status
- **Resource display**: Show minimal resource usage information

### Workflow Integration
- **Seamless switching**: Easy conversion between sparse and full modes
- **Context preservation**: Maintain conversation history during mode changes
- **Feature availability**: Gray out or hide unavailable features appropriately
- **Clear messaging**: Explain what's available in each mode

## Implementation Details

### Mode Management
- Sparse cell type detection and handling
- Service provisioning bypass logic
- Workspace creation for agent-only mode
- Mode conversion and upgrade procedures

### Resource Optimization
- Minimal resource allocation for sparse cells
- Efficient agent session management
- Reduced monitoring overhead
- Optimized storage for agent-only data

### Feature Adaptation
- Conditional UI rendering based on cell mode
- Service availability detection and adaptation
- Workflow routing for sparse vs full cells
- State management across mode transitions

## Integration Points
- **Agent Orchestration Engine**: Manages agent sessions without service dependencies
- **Cell Creation/Provisioning**: Handles sparse cell creation and conversion
- **Template Definition System**: Supports sparse cell templates
- **Persistence Layer**: Stores sparse cell metadata and state

## Testing Strategy
- Test sparse cell creation and agent functionality
- Verify service bypass and resource optimization
- Test conversion from sparse to full cells
- Validate UI adaptations for sparse mode
- Test workflow continuity across mode changes
- Performance testing for sparse vs full cells

## Testing Strategy
*This section needs to be filled in with specific testing approaches for sparse cells functionality.*
