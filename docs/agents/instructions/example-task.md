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
  - Create user model
  - Implement registration endpoint
  - Implement login endpoint
  - Add session management
  - Create tests

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
