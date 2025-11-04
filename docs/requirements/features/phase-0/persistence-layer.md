# Persistence Layer

- [ ] Persistence Layer #status/planned #phase-0 #feature/core

## Goal
Provide reliable storage for constructs, transcripts, artifacts, and metadata with ACID guarantees and efficient access patterns.

## Requirements

### Database Schema
- **Primary store**: Use SQLite as the primary database for constructs, prompt bundles, agent sessions, and transcripts.
- **Schema design**: Provide normalized tables for constructs, sessions, services, and agent messages with explicit foreign keys in application code.
- **Migration system**: Version schema changes with Drizzle migrations committed to source control.
- **Indexing strategy**: Optimise for construct listings and transcript lookups by session.

### Artifact Storage
- Phase 0 stores transcripts directly in SQLite; external artifact storage (logs, diff bundles) is deferred to a later phase.

### Data Access Patterns
- **Construct queries**: Provide straightforward listing of constructs ordered by recency and filterable by status.
- **Transcript access**: Return transcripts chronologically for a given session so the UI can render chat history.
- **Service state**: Expose current service status and configuration for each construct.

### Performance & Scaling
- **Connection management**: Reuse a single SQLite connection per process and keep operations lightweight.
- **Query optimization**: Use prepared statements and indexes where needed to keep construct and transcript queries responsive.
- **Cleanup policies**: Provide manual deletion APIs for constructs; automated retention policies are a later enhancement.

### Backup & Recovery
- Provide basic guidance on backing up the SQLite database file; advanced export/import tooling is deferred to a future phase.

## UX Requirements

### Data Management Interface
- **Storage usage display**: Show per-construct and total storage usage with breakdown by type
- **Cleanup controls**: Allow users to manually clean up old constructs, artifacts, and transcripts
- **Export/Import UI**: Simple interface for backing up and restoring construct data
- **Retention settings**: User-configurable policies for automatic cleanup of old data

### Performance Feedback
- **Query performance indicators**: Show loading states and progress for long-running queries
- **Background operation status**: Display progress for migrations, compaction, and cleanup operations
- **Error notifications**: Clear feedback for storage issues, corruption, or recovery failures

## Implementation Details

### Schema Design
- Normalized tables for constructs, sessions, transcripts, artifacts with proper relationships
- Efficient indexing for common query patterns (status filters, time ranges, text search)
- Migration system with version tracking and rollback capabilities

### File Management
- Organized directory structure for artifacts by construct ID and type
- Compression and deduplication for text-based content
- Reference integrity maintenance between database and file system

### Performance Optimization
- Connection pooling and prepared statements for SQLite
- Caching layer for frequently accessed metadata
- Background cleanup and maintenance tasks

## Integration Points
- **Agent Orchestration Engine**: Stores session state, transcripts, and events
- **Construct Creation/Provisioning**: Persists construct metadata and provisioning state
- **Planning-to-Implementation Handoff**: Persists plans and cross-construct relationships
- **Activity Timeline**: Provides time-series data for timeline rendering
- **Cross-Construct Search**: Indexes content for search functionality
- **Metrics Baseline**: Stores timing and intervention data for analytics

## Testing Strategy
- Test schema migrations and ensure new tables (constructs, sessions, messages) apply cleanly to a fresh database.
- Verify transcript persistence by exercising message flows through the mock orchestrator.
- Confirm construct and service records update correctly as provisioning and agent lifecycles run.
- Validate manual cleanup flows (construct deletion) remove related services, sessions, and transcripts.
