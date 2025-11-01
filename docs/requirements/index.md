# Requirements Index

## Core Concepts
- [Constructs](concepts/constructs.md) - Core construct model, lifecycle, and roadmap
- [Runtime](concepts/runtime.md) - Technical implementation details

## Implementation Strategy
- [Development Strategy](implementation-strategy.md) - Phase-by-phase development approach

## Features by Phase

### Phase 0: Core Infrastructure
- [Agent Orchestration Engine](features/phase-0/agent-orchestration.md) - Core engine for managing agent sessions
- [Persistence Layer](features/phase-0/persistence-layer.md) - Reliable storage for constructs and artifacts
- [Template Definition System](features/phase-0/template-definition-system.md) - System for defining construct templates
- [Prompt Assembly Pipeline](features/phase-0/prompt-assembly-pipeline.md) - System for assembling agent prompts

### Phase 1: Core Runtime
- [Diff Review](features/phase-1/diff-review.md) - Comprehensive diff review experience
- [Docker & Compose Support](features/phase-1/docker-compose-support.md) - Container-based service support
- [Service Control](features/phase-1/service-control.md) - Service management through UI and CLI
- [Workspace Discovery & Switching](features/phase-1/workspace-switching.md) - Multi-workspace management

### Phase 2: Advanced Interaction
- [Voice Input](features/phase-2/voice-input.md) - Microphone capture and transcription
- [Sparse Constructs](features/phase-2/sparse-constructs.md) - Agent-only lightweight constructs
- [Template Prompt Viewer](features/phase-2/template-prompt-viewer.md) - Preview template prompts
- [Compaction Logging](features/phase-2/compaction-logging.md) - Monitor prompt degradation
- [Linear Integration](features/phase-2/linear-integration.md) - Create constructs from Linear issues
- [GitHub Integration](features/phase-2/github-integration.md) - GitHub branch and PR integration
- [Cross-Construct Search](features/phase-2/cross-construct-search.md) - Search across construct data

### Phase 3: Planning & Collaboration
- [Planning-to-Implementation Handoff](features/phase-3/planning-handoff.md) - Workflow transitions
- [Reference Repos](features/phase-3/reference-repos.md) - External repository access
- [Config Editor](features/phase-3/config-editor.md) - UI for editing configuration
- [Inline Prompt Editor](features/phase-3/inline-prompt-editor.md) - Edit prompts in-app
- [Context Switching Aids](features/phase-3/context-switching-aids.md) - Regain context quickly
- [Plan Export](features/phase-3/plan-export.md) - Export plans to external systems
- [Prompt Optimisation](features/phase-3/prompt-optimisation.md) - Optimize prompt bundles

### Phase 4: Analytics & Terminal
- [Insight Analytics](features/phase-4/insight-analytics.md) - Trend reporting and metrics
- [Activity Timeline](features/phase-4/activity-timeline.md) - Chronological activity view
- [Terminal UI](features/phase-4/terminal-ui.md) - Terminal-based interface
- [Metrics Baseline](features/phase-4/metrics-baseline.md) - Capture baseline metrics

## Shared Concerns
- [Workspace & Template Configuration](configuration.md) - Config files and template system
- [Testing Strategy](testing.md) - Testing philosophy and implementation
- [Platform Modalities](platform.md) - Web and desktop deployment options
