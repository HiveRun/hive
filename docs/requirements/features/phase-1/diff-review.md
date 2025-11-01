# Diff Review

- [ ] Diff Review #status/planned #phase-1 #feature/ux

## Goal
Provide a comprehensive diff review experience within Synthetic so users can review agent changes without leaving the platform.

## Requirements

### Core Diff Functionality
- Show a file tree grouped by status (modified/added/deleted) based on a fresh diff each time the panel opens.
- Render inline or side-by-side views using semantic output from [Difftastic](https://difftastic.wilfred.me.uk) when available, with fallback to classic git diff.
- Clearly indicate the base commit the diff is computed against.
- **Dual diff modes**: Allow toggling between:
  1. **Branch diff**: From branch base (e.g., main) to current state
  2. **Uncommitted diff**: From current state to staged changes

### Diff Navigation & Interaction
- **File-level navigation**: Quick jump between modified files with keyboard shortcuts
- **Line-level actions**: Stage/unstage individual hunks or lines
- **Search within diff**: Find specific changes across large diff sets
- **Diff statistics**: Show summary of additions, deletions, and modifications

### Integration Features
- **Commenting**: Add line-level comments on diff hunks for feedback
- **Staging controls**: Stage/unstage changes directly from diff view
- **Commit integration**: Create commits from diff review with custom messages
- **Branch management**: Create branches from current changes during review

## UX Requirements

### Diff Display
- **Clear visual hierarchy**: Distinguish between file types, change types, and significance
- **Responsive layout**: Adapt diff view for different screen sizes and orientations
- **Theme support**: Consistent diff rendering across light/dark themes
- **Loading states**: Show progress indicators for large diff computations

### User Controls
- **View switching**: Easy toggle between inline, side-by-side, and unified diff formats
- **Zoom controls**: Adjust text size and spacing for readability
- **Context controls**: Show/hide surrounding lines for focused review
- **Keyboard shortcuts**: Comprehensive keyboard navigation for power users

### Performance
- **Large diff handling**: Efficient rendering for diffs with many files or large changes
- **Lazy loading**: Load diff content on demand for better performance
- **Virtual scrolling**: Handle very large files without UI degradation
- **Caching**: Cache diff computations for quick switching between views

## Implementation Details

### Diff Engine Integration
- Difftastic integration with fallback to git diff
- Diff computation optimization for large repositories
- Incremental diff updates for real-time changes
- Diff metadata extraction and storage

### UI Components
- File tree component with status indicators
- Diff viewer component with multiple render modes
- Commenting system with line-level precision
- Staging controls with visual feedback

### Performance Optimizations
- Virtual scrolling for large diff lists
- Diff chunking and lazy loading
- Background diff computation
- Memory-efficient diff storage

## Integration Points
- **Agent Orchestration Engine**: Receives diff change events from agent modifications
- **Persistence Layer**: Stores diff metadata and user comments
- **Service Control**: Integrates with file system monitoring for change detection
- **Planning-to-Implementation Handoff**: Provides diff context for implementation reviews

## Testing Strategy
- Test diff accuracy across various file types and encodings
- Verify performance with large repositories and change sets
- Test Difftastic integration and fallback scenarios
- Validate UI responsiveness and keyboard navigation
- Test staging and commit workflows
- Cross-browser compatibility testing for diff rendering

## Testing Strategy
*This section needs to be filled in with specific testing approaches for diff review functionality.*
