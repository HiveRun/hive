# Requirements Index

## Core Concepts
- [Constructs](concepts/constructs.md) - Core construct model, lifecycle, and roadmap
- [Runtime](concepts/runtime.md) - Technical implementation details

## Implementation Strategy
- [Development Strategy](implementation-strategy.md) - Phase-by-phase development approach

## Features by Phase

### Phase 0: Core Infrastructure
- [ ] [Agent Orchestration Engine](features/phase-0/agent-orchestration.md) #status/planned #phase-0 #feature/core - Core engine for managing agent sessions with integrated UX
- [ ] [Construct Creation & Provisioning](features/phase-0/construct-creation.md) #status/planned #phase-0 #feature/core - Template selection and workspace setup
- [ ] [Persistence Layer](features/phase-0/persistence-layer.md) #status/planned #phase-0 #feature/core - Reliable storage for constructs and artifacts
- [ ] [Template Definition System](features/phase-0/template-definition-system.md) #status/planned #phase-0 #feature/core - System for defining construct templates
- [ ] [Prompt Assembly Pipeline](features/phase-0/prompt-assembly-pipeline.md) #status/planned #phase-0 #feature/core - System for assembling agent prompts

### Phase 1: Core Runtime
- [ ] [Diff Review](features/phase-1/diff-review.md) #status/planned #phase-1 #feature/ux - Comprehensive diff review experience
- [ ] [Docker & Compose Support](features/phase-1/docker-compose-support.md) #status/planned #phase-1 #feature/infrastructure - Container-based service support
- [ ] [Service Control](features/phase-1/service-control.md) #status/planned #phase-1 #feature/infrastructure - Service management through UI and CLI
- [ ] [Workspace Discovery & Switching](features/phase-1/workspace-switching.md) #status/planned #phase-1 #feature/ux - Multi-workspace management

### Phase 2: Advanced Interaction
- [ ] [Voice Input](features/phase-2/voice-input.md) #status/planned #phase-2 #feature/advanced - Microphone capture and transcription
- [ ] [Sparse Constructs](features/phase-2/sparse-constructs.md) #status/planned #phase-2 #feature/advanced - Agent-only lightweight constructs
- [ ] [Template Prompt Viewer](features/phase-2/template-prompt-viewer.md) #status/planned #phase-2 #feature/advanced - Preview template prompts
- [ ] [Compaction Logging](features/phase-2/compaction-logging.md) #status/planned #phase-2 #feature/advanced - Monitor prompt degradation
- [ ] [Linear Integration](features/phase-2/linear-integration.md) #status/planned #phase-2 #feature/advanced - Create constructs from Linear issues
- [ ] [GitHub Integration](features/phase-2/github-integration.md) #status/planned #phase-2 #feature/advanced - GitHub branch and PR integration
- [ ] [Cross-Construct Search](features/phase-2/cross-construct-search.md) #status/planned #phase-2 #feature/advanced - Search across construct data

### Phase 3: Planning & Collaboration
- [ ] [Planning-to-Implementation Handoff](features/phase-3/planning-handoff.md) #status/planned #phase-3 #feature/advanced - Workflow transitions
- [ ] [Reference Repos](features/phase-3/reference-repos.md) #status/planned #phase-3 #feature/advanced - External repository access
- [ ] [Config Editor](features/phase-3/config-editor.md) #status/planned #phase-3 #feature/advanced - UI for editing configuration
- [ ] [Inline Prompt Editor](features/phase-3/inline-prompt-editor.md) #status/planned #phase-3 #feature/advanced - Edit prompts in-app
- [ ] [Context Switching Aids](features/phase-3/context-switching-aids.md) #status/planned #phase-3 #feature/advanced - Regain context quickly
- [ ] [Plan Export](features/phase-3/plan-export.md) #status/planned #phase-3 #feature/advanced - Export plans to external systems
- [ ] [Prompt Optimisation](features/phase-3/prompt-optimisation.md) #status/planned #phase-3 #feature/advanced - Optimize prompt bundles

### Phase 4: Analytics & Terminal
- [ ] [Insight Analytics](features/phase-4/insight-analytics.md) #status/planned #phase-4 #feature/advanced - Trend reporting and metrics
- [ ] [Activity Timeline](features/phase-4/activity-timeline.md) #status/planned #phase-4 #feature/advanced - Chronological activity view
- [ ] [Terminal UI](features/phase-4/terminal-ui.md) #status/planned #phase-4 #feature/advanced - Terminal-based interface
- [ ] [Metrics Baseline](features/phase-4/metrics-baseline.md) #status/planned #phase-4 #feature/advanced - Capture baseline metrics

## Status Tracking

All features use the **Obsidian Tasks** format for status tracking:

```markdown
- [ ] Feature Name #status/planned #phase-X #feature/category
```

**Status Options:**
- `[ ]` - Planned/Not started
- `[/]` - In progress  
- `[x]` - Completed
- `[-]` - Blocked

**Tags:**
- `#status/planned/in-progress/completed/blocked` - Progress status
- `#phase-0/1/2/3/4` - Development phase (natural priority ordering)
- `#feature/core/ux/infrastructure/advanced` - Feature categorization

Use Obsidian's Tasks search to filter by any combination of tags.

## Shared Concerns
- [Workspace & Template Configuration](configuration.md) - Config files and template system
- [Testing Strategy](testing.md) - Testing philosophy and implementation
- [Platform Modalities](platform.md) - Web and desktop deployment options
