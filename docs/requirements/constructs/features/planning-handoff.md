# Planning-to-Implementation Handoff

## Goal
Enable seamless workflow transitions between planning and implementation phases, including the planning agent type and plan submission/approval process.

## Key Requirements

### Planning Agent Type
- **Planning constructs**: Launch OpenCode in plan mode with limited toolset focused on analysis and documentation rather than code execution.
- **Planning-specific prompts**: Inject planning-specific guidance that emphasizes analysis, requirements gathering, and structured plan generation over direct implementation.
- **Tool restrictions**: Limit file system access to read-only operations, disable destructive commands, and provide planning-specific tools (diagram generation, requirement analysis).
- **Plan format expectations**: Define clear schema for plan submissions (sections, acceptance criteria, implementation steps, dependencies).

### Plan Submission & Storage
- **MCP endpoint**: Expose `synthetic.plan.submit` that planning agents must call with generated plans.
- **Plan validation**: Validate submitted plans against the expected schema before acceptance.
- **Version control**: Store each plan submission with version history, allowing comparison between iterations.
- **Persistence**: Store plans in SQLite + generate `PLAN.md` files in the construct worktree for reference.

### Approval Workflow
- **Review interface**: Surface submitted plans to users in a structured review format with clear acceptance criteria.
- **Approval actions**: Provide options to approve, request revisions, or reject plans with feedback.
- **Revision handling**: When revisions are requested, return the planning construct to active state with user feedback incorporated into the next prompt.

### Handoff to Implementation
- **Conversion workflow**: On approval, create (or convert to) an implementation construct seeded with the approved plan context.
- **Context preservation**: Link the planning and implementation constructs for full traceability.
- **Manual option**: Allow users to start a manual construct from the approved plan if they prefer to execute changes themselves.
- **Plan seeding**: Initialize the implementation agent with the approved plan as context, including specific implementation steps and acceptance criteria.

### State Management
- **Status tracking**: Maintain clear construct states throughout the handoff process (planning → awaiting_approval → approved → implementation).
- **Rollback capability**: Support reverting from implementation back to planning if major issues are discovered.
- **Cross-construct linking**: Maintain bidirectional references between planning and implementation constructs.

## Integration Points
- **Agent Orchestration Engine**: Manages both planning and implementation agent sessions
- **Persistence Layer**: Stores plans, versions, and cross-construct relationships
- **Prompt Assembly Pipeline**: Provides planning-specific vs implementation-specific prompts
- **Activity Timeline**: Tracks plan submissions, approvals, and handoff events