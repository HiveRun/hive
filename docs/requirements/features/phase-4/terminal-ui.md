# Terminal UI

## Goal
Deliver a terminal-based frontend that mirrors the core Synthetic experience, powered by `@sst/opentui`.

## Requirements

### Core TUI Functionality
- Reuse existing APIs so the TUI presents construct lists, chat, diff, and service status.
- Support keyboard shortcuts for command menu actions and construct navigation.
- Handle streaming logs and notifications within the terminal context.
- Consider multi-construct workflows (tabs/panes) similar to the web UI.

### Terminal Experience
- **Responsive layout**: Adaptive terminal UI for different terminal sizes and resolutions
- **Color themes**: Support for light/dark themes and terminal color schemes
- **Mouse support**: Optional mouse interaction for improved usability
- **Accessibility**: Screen reader compatibility and high contrast modes

### Performance & Efficiency
- **Low resource usage**: Minimal memory and CPU overhead for terminal operation
- **Fast rendering**: Efficient updates for streaming data and real-time changes
- **Keyboard optimization**: Comprehensive keyboard shortcuts for power users
- **Background operations**: Handle long-running tasks without blocking UI

## UX Requirements

### Navigation & Interaction
- **Intuitive layout**: Familiar terminal interface patterns and navigation
- **Command palette**: Quick access to all actions and commands
- **Context menus**: Right-click or keyboard-triggered context actions
- **Help system**: Built-in help and keyboard shortcut reference

### Multi-Construct Management
- **Tab/pane system**: Organize multiple constructs simultaneously
- **Quick switching**: Fast navigation between open constructs
- **Status overview**: At-a-glance status for all active constructs
- **Workspace awareness**: Clear indication of current workspace context

### Terminal Integration
- **Shell integration**: Launch external commands and tools from TUI
- **Clipboard support**: Copy/paste functionality within terminal constraints
- **Notification handling**: Display system and application notifications appropriately
- **Streaming display**: Handle real-time data updates efficiently

## Implementation Details

### TUI Framework
- `@sst/opentui` integration and customization
- Component-based architecture for reusable UI elements
- Event handling and state management
- Layout system for responsive terminal design

### API Integration
- Reuse existing web APIs for data access
- Real-time event streaming and updates
- Authentication and session management
- Error handling and recovery procedures

### Performance Optimization
- Virtual rendering for large data sets
- Efficient text rendering and scrolling
- Background task management
- Memory usage optimization

## Integration Points
- **All Core Features**: TUI provides alternative interface to all web functionality
- **Agent Orchestration Engine**: Manages agent sessions and chat in terminal context
- **Service Control**: Displays and controls services through terminal interface
- **Persistence Layer**: Accesses stored data through same APIs as web UI

## Testing Strategy
- Test TUI functionality across different terminal types and sizes
- Verify keyboard shortcuts and navigation patterns
- Test performance with large datasets and streaming data
- Validate accessibility features and screen reader support
- Cross-platform compatibility testing (Linux, macOS, Windows)
- Integration testing with existing API endpoints

## Testing Strategy
*This section needs to be filled in with specific testing approaches for terminal UI functionality.*
