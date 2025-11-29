# Persistence Layer

- [d] Persistence Layer #status/deferred #phase-0 #feature/advanced

> **Note**: This feature is **deferred** to focus on core functionality. See [[PR-SEQUENCE.md]] for current implementation path.
> 
> **Current Approach**: Each PR adds only the database tables and queries it actually needs. This document describes the complete schema that was originally planned for Phase 0.
> 
> **What's Implemented Instead**:
> - **Step 2**: Basic `cells` table (minimal schema)
> - **Step 4**: `cells` table stores `opencode_session_id` (OpenCode persists transcripts)
> - **Step 3**: Adds `workspace_path` to cells table

> **Template Storage**: Templates are intentionally stored as files (`hive.config.ts`) rather than in the database. This architectural decision prioritizes version control, type safety, and developer experience over dynamic template management.

## Goal
Provide reliable storage for cells, transcripts, artifacts, and metadata with ACID guarantees and efficient access patterns.

## Current Status: DEFERRED

This feature represents the **comprehensive persistence system** that was originally planned for Phase 0. It has been deferred to accelerate delivery of core functionality.

### What's Implemented Instead
- **Step 2**: Basic `cells` table with minimal schema
- **Step 3**: Adds `workspace_path` column for worktree support
- Agent transcript persistence now lives entirely inside OpenCode's store. Hive no longer creates local `agent_sessions` / `agent_messages` tables; the backend proxies directly to OpenCode when transcript history is needed.

### When This Will Be Implemented
The complete persistence system with all tables, indexes, and optimizations will be implemented in **Phase 1A** after core functionality path is complete and validated.

## Requirements

### Database Schema
- **Primary store**: Use SQLite as the primary database for cells, transcripts, statuses, and metadata to gain ACID writes with minimal setup.
- **Schema design**: Design normalized tables for cells, sessions, transcripts, artifacts, and relationships.
- **Migration system**: Version the schema alongside app releases with a simple `hive migrate` command.
- **Indexing strategy**: Optimize queries for common access patterns (cell listings, transcript streaming, artifact retrieval).

### Artifact Storage
- **Large file handling**: Persist large artifacts, command logs, and diff bundles as raw files on disk referenced from SQLite tables for fast streaming.
- **File organization**: Organize artifacts by cell ID and type for easy cleanup and backup.
- **Compression**: Apply appropriate compression for text-based artifacts (transcripts, logs) to save disk space.
- **Reference integrity**: Maintain foreign key relationships between database records and file system artifacts.

### Data Access Patterns
- **Cell queries**: Efficient listing, filtering, and searching of cells by status, type, and metadata.
- **Transcript streaming**: Chunked access to long transcripts for UI rendering without loading entire conversations into memory.
- **Artifact serving**: Fast access to diff bundles, logs, and other artifacts with proper content-type handling.
- **Cross-cell queries**: Support for searching across multiple cells (for features like cross-cell search).

### Performance & Scaling
- **Connection pooling**: Manage SQLite connections efficiently for concurrent access.
- **Query optimization**: Use prepared statements and proper indexing for common queries.
- **Cache strategy**: Implement appropriate caching for frequently accessed data (cell metadata, recent transcripts).
- **Cleanup policies**: Support for configurable retention policies and cleanup of old artifacts.

### Backup & Recovery
- **Export functionality**: Ability to export individual cells or entire workspaces for backup.
- **Import capability**: Restore cells from exported data with proper conflict resolution.
- **Integrity checks**: Periodic validation of database consistency and file system references.
- **Disaster recovery**: Documented procedures for recovering from database corruption.

## UX Requirements

### Data Management Interface
- **Storage usage display**: Show per-cell and total storage usage with breakdown by type
- **Cleanup controls**: Allow users to manually clean up old cells, artifacts, and transcripts
- **Export/Import UI**: Simple interface for backing up and restoring cell data
- **Retention settings**: User-configurable policies for automatic cleanup of old data

### Performance Feedback
- **Query performance indicators**: Show loading states and progress for long-running queries
- **Background operation status**: Display progress for migrations, compaction, and cleanup operations
- **Error notifications**: Clear feedback for storage issues, corruption, or recovery failures

## Implementation Details

### Schema Design
- Normalized tables for cells, sessions, transcripts, artifacts with proper relationships
- Efficient indexing for common query patterns (status filters, time ranges, text search)
- Migration system with version tracking and rollback capabilities

### File Management
- Organized directory structure for artifacts by cell ID and type
- Compression and deduplication for text-based content
- Reference integrity maintenance between database and file system

### Performance Optimization
- Connection pooling and prepared statements for SQLite
- Caching layer for frequently accessed metadata
- Background cleanup and maintenance tasks

## Integration Points
- **Agent Orchestration Engine**: Stores session state, transcripts, and events
- **Cell Creation/Provisioning**: Persists cell metadata and provisioning state
- **Planning-to-Implementation Handoff**: Persists plans and cross-cell relationships
- **Activity Timeline**: Provides time-series data for timeline rendering
- **Cross-Cell Search**: Indexes content for search functionality
- **Metrics Baseline**: Stores timing and intervention data for analytics

## Testing Strategy
- Test schema migrations and data integrity
- Verify performance under load with large datasets
- Test backup/restore functionality and data consistency
- Validate cleanup policies and storage management
- Test concurrent access and transaction handling
- Performance testing for query optimization