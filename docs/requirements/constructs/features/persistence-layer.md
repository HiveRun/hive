# Persistence Layer

## Goal
Provide reliable storage for constructs, transcripts, artifacts, and metadata with ACID guarantees and efficient access patterns.

## Key Requirements

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

## Integration Points
- **Agent Orchestration Engine**: Stores session state, transcripts, and events
- **Planning-to-Implementation Handoff**: Persists plans and cross-construct relationships
- **Activity Timeline**: Provides time-series data for timeline rendering
- **Cross-Construct Search**: Indexes content for search functionality
- **Metrics Baseline**: Stores timing and intervention data for analytics