# Planning-to-Implementation Handoff

- [ ] Planning-to-Implementation Handoff #status/planned #phase-3 #feature/advanced

## Goal
Enable seamless workflow transitions between planning and implementation phases, including planning agent type and plan submission/approval process.

## Requirements

### Planning Agent Type
- **Planning constructs**: Launch OpenCode in plan mode with limited toolset focused on analysis and documentation rather than code execution.
- **Planning-specific prompts**: Inject planning-specific guidance that emphasizes analysis, requirements gathering, and structured plan generation over direct implementation.
- **Tool restrictions**: Limit file system access to read-only operations, disable destructive commands, and provide planning-specific tools (diagram generation, requirement analysis).
- **Plan format expectations**: Define clear schema for plan submissions (sections, acceptance criteria, implementation steps, dependencies).

### Plan Submission & Storage
- **MCP endpoint**: Expose `hive.plan.submit` that planning agents must call with generated plans.
- **Plan validation**: Validate submitted plans against expected schema before acceptance.
- **Version control**: Store each plan submission with version history, allowing comparison between iterations.
- **Persistence**: Store plans in SQLite + generate `PLAN.md` files in construct worktree for reference.

### Approval Workflow
- **Review interface**: Surface submitted plans to users in a structured review format with clear acceptance criteria.
- **Approval actions**: Provide options to approve, request revisions, or reject plans with feedback.
- **Revision handling**: When revisions are requested, return to planning construct to active state with user feedback incorporated into next prompt.

### Handoff to Implementation
- **Implementation construct creation**: Automatically create implementation construct from approved plan.
- **Context transfer**: Move plan context and requirements to implementation agent.
- **State synchronization**: Ensure seamless transition between planning and implementation phases.
- **Progress tracking**: Monitor implementation progress against original plan.

## UX Requirements

### Plan Review Interface
- **Structured display**: Clear presentation of plan sections, requirements, and implementation steps.
- **Comparison tools**: Side-by-side comparison of plan versions and iterations.
- **Annotation system**: Allow users to add comments and feedback directly on plan elements.
- **Approval workflow**: Clear approve/reject/revise actions with reasoning capture.

### Workflow Visualization
- **Status tracking**: Visual representation of planning and implementation progress.
- **Phase indicators**: Clear indication of current phase (planning, review, implementation).
- **Handoff confirmation**: Explicit confirmation when transitioning between phases.
- **History timeline**: Chronological view of plan submissions and revisions.

### Feedback Integration
- **Revision incorporation**: Clear display of how user feedback is incorporated into new plan versions.
- **Comment threading**: Organized conversation around plan elements and feedback.
- **Change highlighting**: Visual indicators of what changed between plan versions.
- **Decision logging**: Record of approval decisions and rationale.

## Implementation Details

### Plan Schema System
- Structured data format for plan submissions
- Validation rules and schema enforcement
- Version tracking and diff generation
- Plan parsing and rendering components

### Workflow Engine
- State machine for planning/review/implementation phases
- Transition logic and validation
- Context transfer between phases
- Progress tracking and synchronization

### MCP Integration
- Plan submission endpoint implementation
- Tool restriction enforcement for planning agents
- Schema validation and error handling
- Version control and history management

## Integration Points
- **Agent Orchestration Engine**: Manages both planning and implementation agent sessions
- **Construct Creation/Provisioning**: Creates implementation constructs from approved plans
- **Persistence Layer**: Stores plan versions, feedback, and workflow state
- **Template Definition System**: Supports planning-specific construct templates

## Testing Strategy
- Test plan submission and validation workflows
- Verify approval workflow and revision handling
- Test phase transitions and context transfer
- Validate plan schema enforcement and error handling
- Test workflow visualization and status tracking
- Cross-phase integration testing

## Testing Strategy
*This section needs to be filled in with specific testing approaches for planning handoff functionality.*
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