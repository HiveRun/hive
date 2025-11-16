# Diff Review

- [/] Diff Review #status/in-progress #phase-1 #feature/ux

## Goal
Provide a comprehensive diff review experience within Synthetic so users can review agent changes without leaving the platform.

## Requirements

### Core Diff Functionality
- Show a file tree grouped by status (modified/added/deleted) based on a fresh diff each time the panel opens.
- Render inline or side-by-side views using `@pierre/precision-diffs` for semantic output, with fallback to classic git diff when precision rendering fails.
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
- Precision Diff integration with fallback to git diff
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
- Test Precision Diff integration and fallback scenarios
- Validate UI responsiveness and keyboard navigation
- Test staging and commit workflows
- Cross-browser compatibility testing for diff rendering

## Investigation Notes (2025-11-15)

### Diff Engines
- **Precision Diff Viewer**: vendor/opencode uses `@pierre/precision-diffs` (`vendor/opencode/packages/ui/src/components/diff.tsx`) to render side-by-side or unified views with syntax highlighting and inline annotations. We'll wrap the same component in React with a thin hook that instantiates `new FileDiff` inside `useEffect`. Feed it `{ name, contents }` pairs sourced from git to get GitHub-grade visuals with staged line numbers.
- **Baseline Git Data**: keep emitting unified patches from `git diff` / `git diff --cached` so we can stage hunks, compute stats, and fall back when semantic engines fail. These patches also power comment context and future integrations.

### Backend Plan
- Track each construct's branch metadata by persisting the branch name and starting commit hash when `createWorktree` (apps/server/src/worktree/manager.ts) clones `construct-<id>`. Store it on the `constructs` table (new columns `branch_name`, `base_commit`).
- Introduce a `DiffService` in `apps/server/src/services` responsible for:
  - Listing changed files grouped by status through porcelain status + `git diff --name-status`.
  - Producing structured file payloads (`before`, `after`, patch, summary) for both "branch" (base commit → HEAD) and "workspace" (HEAD → working tree) modes.
  - Handling staging controls by generating targeted patches and piping them into `git apply --cached` / `git checkout --patch` depending on stage/unstage requests. Line-level staging can be built by slicing the stored patch hunks.
  - Persisting line comments (new table keyed by construct_id + file + commit-ish + line) together with author metadata and timestamps.
- Extend the constructs API with:
  - `GET /api/constructs/:id/diff?mode=branch|workspace&files=...` for initial payloads.
  - `POST /api/constructs/:id/diff/stage` & `/unstage` that accept file/hunk descriptors.
  - `POST /api/constructs/:id/diff/comment` for line comments and `GET /api/constructs/:id/diff/comments` for hydration.
  - `POST /api/constructs/:id/diff/commit` to create commits directly from the diff view.
- Wire agent SSEs: `session.diff` events already arrive via `publishAgentEvent` (apps/server/src/agents/events.ts). Extend `/api/agents/sessions/:id/events` to forward them, and update the client hook so diff tabs refresh automatically when an agent edits files.

### Frontend Plan
- Add a TanStack Start route at `apps/web/src/routes/constructs/$constructId/diff.tsx`. Update the nav in `ConstructLayout` to include a "Diff" button, and make `/constructs/$id/diff` the new default redirect once services and chat remain accessible.
- Loader responsibilities:
  - Read search params (`mode`, `file`, `view=semantic|structured`) via `validateSearch` for deterministic URLs.
  - Ensure diff data via `queryClient.ensureQueryData` so there is no loading flash when switching tabs.
- UI structure:
  - Left column: virtualized file tree grouped by Modified/Added/Deleted with keyboard shortcuts (`j/k` to move, `s` to stage, `u` to unstage) and quick filter input.
  - Right column: diff viewer header with file metadata, stats, and toggles for `Inline | Split | Semantic (Precision)` plus controls for context lines and zoom.
  - Use `@pierre/precision-diffs` for structured inline/split rendering with switchable diff indicators. Fall back to the git patch panel when precision output is unavailable.
  - Inline staging buttons per hunk and individual line checkboxes map to the backend stage API.
  - Comment sidebar that pins draft comments to specific hunks (`lineNumber + side`).
  - Diff summary card (additions, deletions, files) plus branch metadata (base commit SHA, upstream branch) surfaced from the API.
  - Live updates: extend `useAgentEventStream` to listen for `session.diff` and mutate the diff query cache. When the diff tab is visible, request the freshest git status after each event to avoid stale counts.
  - Performance: use `react-virtualized-auto-sizer` or TanStack Virtual to lazy-render large files, keep precision rendering opt-in, and debounce search/filter inputs.


### Ops, Perf, and Testing
- Cache git diff summaries/details per `(constructId, filePath, mode, beforeHash, afterHash)` so repeated openings are instant.
- Protect against binary or oversized files by returning metadata-only entries with download buttons instead of attempting to render diffs.
  - Testing plan:
    - Unit-test the new DiffService with fixture repositories exercising added/modified/deleted, rename detection, and partial staging.
    - Integration tests covering staging API error paths and precision diff fallback (mocked by swapping the renderer with a stub).
    - Playwright visual tests (apps/web/e2e) for the new diff tab across both inline and split layouts plus the semantic toggle to guard Forest Brutalism styling.

- Document how to install and theme `@pierre/precision-diffs` so agents have consistent semantic rendering locally.
