# Obsidian Integration Plan for Project Documentation

## Overview

This plan describes how to integrate Obsidian as a documentation and requirements management system directly within a project repository. The Obsidian vault will be colocated with the project code, enabling seamless documentation alongside development.

## Implementation Instructions for AI Agent

### 1. Initial Setup

**Create the Obsidian vault structure within the project:**

```bash
# From project root, create docs folder as Obsidian vault
mkdir -p docs/.obsidian
mkdir -p docs/{requirements,tasks,agents,architecture,daily,templates,concepts,workflows}

# Create initial .gitignore for Obsidian
cat >> .gitignore << 'EOF'

# Obsidian
docs/.obsidian/workspace.json
docs/.obsidian/workspace-mobile.json
docs/.obsidian/cache
docs/.obsidian/hotkeys.json
docs/.obsidian/appearance.json
EOF
```

### 2. Core Configuration Files

**Create base Obsidian configuration:**

```json
# docs/.obsidian/app.json
{
  "legacyEditor": false,
  "livePreview": true,
  "promptDelete": false,
  "alwaysUpdateLinks": true,
  "newFileLocation": "folder",
  "newFileFolderPath": "docs/inbox",
  "attachmentFolderPath": "docs/assets",
  "readableLineLength": false,
  "showLineNumber": true,
  "showIndentGuide": true,
  "vimMode": false,
  "defaultViewMode": "preview",
  "foldHeading": true,
  "foldIndent": true,
  "showFrontmatter": true
}
```

```json
# docs/.obsidian/core-plugins.json
[
  "file-explorer",
  "global-search",
  "switcher",
  "graph",
  "backlink",
  "canvas",
  "outgoing-link",
  "tag-pane",
  "page-preview",
  "daily-notes",
  "templates",
  "note-composer",
  "command-palette",
  "editor-status",
  "bookmarks",
  "outline",
  "word-count",
  "file-recovery"
]
```

```json
# docs/.obsidian/community-plugins.json
[
  "obsidian-git",
  "templater-obsidian",
  "dataview",
  "obsidian-tasks",
  "obsidian-kanban"
]
```

### 3. Template System

**Create essential templates:**

```markdown
# docs/templates/requirement.md
---
id: REQ-{{date:YYYYMMDD}}-{{time:HHmm}}
type: requirement
created: {{date:YYYY-MM-DD}}
status: draft
priority: medium
tags: [requirement]
---

# {{title}}

## Context
<!-- Why is this requirement needed? -->

## Description
<!-- Detailed description of what needs to be implemented -->

## Acceptance Criteria
- [ ]
- [ ]

## Technical Specification
```yaml
affected_files:
  -
new_files:
  -
dependencies:
  -
test_requirements:
  - Unit tests for
  - Integration tests for
```

## Dependencies
- [[]]

## Notes for AI Agent
<!-- Specific instructions or constraints for implementation -->

## Links
- Related: [[]]
- Implements: [[]]
- Blocks: [[]]
```

```markdown
# docs/templates/task.md
---
id: TASK-{{date:YYYYMMDD}}-{{time:HHmm}}
type: task
created: {{date:YYYY-MM-DD}}
status: todo
assigned_to:
due_date:
tags: [task]
---

# {{title}}

## Description

## Subtasks
- [ ]

## Context
- Parent: [[]]
- Related: [[]]

## For AI Agent
```yaml
task_type: # feature|bugfix|refactor|documentation
priority: # high|medium|low
estimated_effort: # hours
files_to_modify:
  -
test_requirements:
  -
```

## Completion Criteria
- [ ] Code implemented
- [ ] Tests passing
- [ ] Documentation updated
- [ ] PR created
```

```markdown
# docs/templates/daily.md
---
created: {{date:YYYY-MM-DD}}
tags: [daily]
---

# {{date:YYYY-MM-DD}} Daily Plan

## Focus for Today
<!-- Main objectives -->

## Tasks
<!-- Link to task documents -->
### High Priority
- [ ] [[]]

### Medium Priority
- [ ] [[]]

### Low Priority
- [ ] [[]]

## Agent Work Queue
<!-- Tasks assigned to AI agents -->
- [ ] Agent: [[]]
- [ ] Review: [[]]

## Notes
<!-- Important observations or decisions -->

## Tomorrow
<!-- Items to carry forward -->
```

```markdown
# docs/templates/architecture-decision.md
---
id: ADR-{{date:YYYYMMDD}}
type: architecture-decision
created: {{date:YYYY-MM-DD}}
status: proposed
tags: [architecture, decision]
---

# {{title}}

## Status
Proposed | Accepted | Rejected | Deprecated | Superseded

## Context
<!-- What is the issue that we're seeing that is motivating this decision -->

## Decision
<!-- What is the change that we're proposing -->

## Consequences
### Positive
-

### Negative
-

### Neutral
-

## Alternatives Considered
1.

## Implementation Notes
<!-- Notes for implementation, especially for AI agents -->

## References
- [[]]
```

### 4. Index and Navigation Structure

**Create main index file:**

```markdown
# docs/index.md
---
tags: [index, home]
---

# Project Documentation

## Quick Links
- [[requirements/index|Requirements Overview]]
- [[tasks/index|Current Tasks]]
- [[architecture/index|Architecture Decisions]]
- [[agents/index|AI Agent Instructions]]

## Project Status
```dataview
TABLE status, priority, due_date
FROM "tasks"
WHERE status != "completed"
SORT priority DESC
LIMIT 10
```

## Recent Updates
```dataview
LIST
FROM ""
SORT created DESC
LIMIT 10
```

## Important Concepts
- [[concepts/core-concepts|Core Concepts]]
- [[workflows/development-workflow|Development Workflow]]
- [[architecture/system-overview|System Overview]]
```

### 5. Git Integration Setup

**Configure Obsidian Git plugin settings:**

```json
# docs/.obsidian/plugins/obsidian-git/data.json
{
  "commitMessage": "docs: {{date}} vault update",
  "autoCommitMessage": "docs: auto {{date}}",
  "commitDateFormat": "YYYY-MM-DD HH:mm:ss",
  "autoSaveInterval": 30,
  "autoPushInterval": 0,
  "autoPullInterval": 30,
  "autoPullOnBoot": true,
  "disablePush": false,
  "pullBeforePush": true,
  "disablePopups": false,
  "currentBranch": "main",
  "remote": "origin"
}
```

### 6. AI Agent Instructions Folder

**Create structure for AI agent consumption:**

```markdown
# docs/agents/instructions/README.md
---
type: agent-instructions
---

# AI Agent Instructions

This folder contains specific instructions and context for AI agents working on this project.

## How to Use
1. Each task should reference a specific instruction document
2. Instructions should be self-contained with all necessary context
3. Use YAML frontmatter for machine-readable configuration
4. Link to related requirements and architecture decisions

## Current Agent Tasks
```dataview
TABLE status, assigned_to, priority
FROM "tasks"
WHERE assigned_to = "agent"
SORT priority DESC
```
```

```markdown
# docs/agents/instructions/example-task.md
---
type: agent-instruction
task_id: TASK-001
created: 2024-01-20
---

# Agent Task: Implement User Authentication

## Objective
Implement user authentication system according to [[requirements/auth-requirements]].

## Specific Instructions
```yaml
implementation_order:
  1. Create user model
  2. Implement registration endpoint
  3. Implement login endpoint
  4. Add session management
  5. Create tests

constraints:
  - Use existing database schema
  - Follow project coding standards
  - Maintain backward compatibility

files_to_modify:
  - src/models/user.js
  - src/routes/auth.js
  - src/middleware/auth.js

test_requirements:
  - Unit tests for all new functions
  - Integration tests for endpoints
  - Edge case handling

dependencies:
  - Database must be configured
  - Environment variables must be set
```

## References
- Requirements: [[requirements/REQ-001-authentication]]
- Architecture: [[architecture/ADR-001-auth-strategy]]
```

### 7. Dataview Queries for AI Agents

**Create queryable views:**

```markdown
# docs/agents/current-work.md
---
type: agent-view
---

# Current Agent Work

## High Priority Tasks
```dataview
TABLE status, due_date, file.link AS "Task"
FROM "tasks"
WHERE assigned_to = "agent" AND priority = "high"
SORT due_date ASC
```

## Requirements Ready for Implementation
```dataview
TABLE status, priority, file.link AS "Requirement"
FROM "requirements"
WHERE status = "approved" AND !completed
SORT priority DESC
```

## Blocked Tasks
```dataview
TABLE blocked_by, reason, file.link AS "Task"
FROM "tasks"
WHERE status = "blocked"
```
```

### 8. Migration Script

**For migrating existing markdown docs to Obsidian structure:**

```bash
#!/bin/bash
# migrate-to-obsidian.sh

# Create vault structure
mkdir -p docs/{requirements,tasks,agents,architecture,daily,templates,concepts,workflows,assets,inbox}

# Move existing documentation
if [ -d "ARCHITECTURE.md" ]; then
  mv ARCHITECTURE.md docs/architecture/system-overview.md
fi

if [ -d "CORE_CONCEPTS.md" ]; then
  mv CORE_CONCEPTS.md docs/concepts/core-concepts.md
fi

# Add frontmatter to existing files
for file in docs/**/*.md; do
  if ! grep -q "^---" "$file"; then
    # Add basic frontmatter
    filename=$(basename "$file" .md)
    created=$(git log --follow --format=%aI --reverse "$file" | head -1 | cut -d'T' -f1)

    cat > temp.md << EOF
---
id: $filename
type: document
created: ${created:-$(date +%Y-%m-%d)}
tags: [migrated]
---

EOF
    cat "$file" >> temp.md
    mv temp.md "$file"
  fi
done

# Create index files
cat > docs/requirements/index.md << 'EOF'
# Requirements

## All Requirements
```dataview
TABLE status, priority, created
FROM "requirements"
SORT priority DESC
```
EOF

echo "Migration complete! Open docs/ folder in Obsidian"
```

### 9. Integration with Development Workflow

**Add npm/make scripts for documentation:**

```json
// package.json additions
{
  "scripts": {
    "docs:serve": "cd docs && obsidian .",
    "docs:build": "npx @quartz/cli -d docs build",
    "docs:publish": "npm run docs:build && netlify deploy --dir=public",
    "docs:new-req": "node scripts/new-requirement.js",
    "docs:new-task": "node scripts/new-task.js"
  }
}
```

### 10. Publishing Configuration (Optional)

**For web publishing with Quartz:**

```yaml
# docs/quartz.config.ts
import { QuartzConfig } from "@quartz/quartz"

const config: QuartzConfig = {
  configuration: {
    pageTitle: "Project Documentation",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    baseUrl: "docs.your-project.com",
    ignorePatterns: ["templates", ".obsidian"],
    theme: {
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono"
      }
    }
  },
  plugins: {
    transformers: [
      // Plugin configuration
    ],
    filters: [
      // Filter configuration
    ],
    emitters: [
      // Emitter configuration
    ]
  }
}

export default config
```

## Verification Checklist

After implementation, verify:

- [ ] Obsidian opens the docs/ folder successfully
- [ ] Templates are accessible via Templater plugin
- [ ] Git integration works (auto-commit/pull)
- [ ] Dataview queries return results
- [ ] Links between documents work
- [ ] .gitignore properly excludes Obsidian cache files
- [ ] Daily notes create in correct folder
- [ ] Tags and backlinks are functional
- [ ] Search works across all documents

## Notes for AI Agent Implementation

1. Create all directories and files in order listed
2. Preserve any existing markdown documentation by moving to appropriate folders
3. Add frontmatter to all markdown files for better organization
4. Test that the vault opens correctly in Obsidian before committing
5. Ensure all template variables use Templater syntax (double curly braces)
6. Maintain consistent file naming: lowercase with hyphens (kebab-case)
7. Create empty index.md files in each major directory for navigation

## Expected Project Structure After Implementation

```
project-root/
├── src/                 # Project source code
├── tests/               # Project tests
├── docs/                # Obsidian vault
│   ├── .obsidian/       # Obsidian configuration
│   ├── requirements/    # Requirements documents
│   ├── tasks/          # Task tracking
│   ├── agents/         # AI agent instructions
│   ├── architecture/   # Architecture decisions
│   ├── concepts/       # Conceptual documentation
│   ├── workflows/      # Process documentation
│   ├── daily/          # Daily notes
│   ├── templates/      # Document templates
│   ├── assets/         # Images and attachments
│   └── index.md        # Vault home page
├── .gitignore          # Updated with Obsidian excludes
└── README.md           # Project readme
```

This structure provides a complete documentation system alongside your code, accessible through Obsidian for planning and requirements management while remaining fully version-controlled with git.