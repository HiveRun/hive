# Persistence Layer

- [ ] Persistence Layer #status/planned #phase-0 #feature/core

> **Note**: Persistence is not a single PR. Instead, each PR adds only the database tables and queries it actually needs. This document describes the complete Phase 0 schema after all PRs are merged.

## Goal
Provide reliable storage for constructs, transcripts, artifacts, and metadata with ACID guarantees and efficient access patterns.

## Requirements

### Database Schema
- **Primary store**: Use SQLite as the primary database for constructs, transcripts, statuses, and metadata to gain ACID writes with minimal setup.
- **Schema design**: Design normalized tables for constructs, sessions, transcripts, artifacts, and relationships.
- **Migration system**: Version the schema alongside app releases with a simple `synthetic migrate` command.
- **Indexing strategy**: Optimize queries for common access patterns (construct listings, transcript streaming, artifact retrieval).

### Artifact Storage
- **Large file handling**: Persist large artifacts, command logs, and diff bundles as raw files on disk referenced from SQLite tables for fast streaming.
- **File organization**: Organize artifacts by construct ID and type for easy cleanup and backup.
- **Compression**: Apply appropriate compression for text-based artifacts (transcripts, logs) to save disk space.
- **Reference integrity**: Maintain foreign key relationships between database records and file system artifacts.

### Data Access Patterns
- **Construct queries**: Efficient listing, filtering, and searching of constructs by status, type, and metadata.
- **Transcript streaming**: Chunked access to long transcripts for UI rendering without loading entire conversations into memory.
- **Artifact serving**: Fast access to diff bundles, logs, and other artifacts with proper content-type handling.
- **Cross-construct queries**: Support for searching across multiple constructs (for features like cross-construct search).

### Performance & Scaling
- **Connection pooling**: Manage SQLite connections efficiently for concurrent access.
- **Query optimization**: Use prepared statements and proper indexing for common queries.
- **Cache strategy**: Implement appropriate caching for frequently accessed data (construct metadata, recent transcripts).
- **Cleanup policies**: Support for configurable retention policies and cleanup of old artifacts.

### Backup & Recovery
- **Export functionality**: Ability to export individual constructs or entire workspaces for backup.
- **Import capability**: Restore constructs from exported data with proper conflict resolution.
- **Integrity checks**: Periodic validation of database consistency and file system references.
- **Disaster recovery**: Documented procedures for recovering from database corruption.

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
- Test schema migrations and data integrity
- Verify performance under load with large datasets
- Test backup/restore functionality and data consistency
- Validate cleanup policies and storage management
- Test concurrent access and transaction handling
- Performance testing for query optimization