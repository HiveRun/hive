# Construct Creation & Provisioning

- [ ] Construct Creation & Provisioning #status/planned #phase-0 #feature/core

## Goal
Handle the complete workflow of creating and provisioning constructs from templates, including workspace setup, service initialization, and prompt assembly.

## Requirements

### Core Provisioning
- **Template Selection**: Allow users to browse and select from available construct templates defined in `synthetic.config.ts`.
- **Workspace Provisioning**: Create an isolated `.constructs/<construct-id>` directory for each construct so working files do not pollute the main repo.
- **Service Setup**: Initialize process-based services declared on the template and record their runtime configuration.
- **Port Allocation**: Dynamically allocate ports using best-effort probing to avoid collisions with host services.
- **Prompt Assembly**: Compose the initial agent prompt from configured sources, template fragments, and construct context.
- **Environment Configuration**: Export allocated ports and template environment variables to the service process.

## UX Requirements

### Template Selection Interface
- Display available templates with label, summary, and type so users can pick the right workflow.
- Provide a simple form for construct name, optional description, and template selection with client-side validation.
- Redirect to the newly created construct on success and surface toast notifications for success or failure.

### Provisioning Feedback
- While provisioning runs on the server, keep the UI responsive and display any errors returned by the API.
- When provisioning fails, surface the error message and allow the user to retry once issues are addressed.

## Implementation Details

### Template Selection Interface
- Source template definitions from `synthetic.config.ts` and expose them through the API for the web UI.

### Workspace Provisioning
- Create `.constructs/<construct-id>` on disk, update the construct record with the path, and ensure directories exist before service startup.

### Service Management
- Iterate over process-based services, spawn them using `child_process.spawn`, and persist runtime metadata (command, cwd, env, ports).
- Record service lifecycle transitions in the database so the UI can display current status.

### Port Allocation Strategy
- Probe host ports sequentially, preferring the template's requested ports when available.
- Expose resolved port assignments via environment variables using the template's `env` mapping.

### Prompt Assembly Context
- Resolve prompt sources relative to the workspace, deduplicate files, and compute a token estimate for the assembled Markdown bundle.
- Inject construct context (IDs, directories, env) into the assembled prompt before persisting it.

## Integration Points
- **Template Definition System**: Provides template metadata and configuration schemas
- **Prompt Assembly Pipeline**: Handles the composition of agent prompts from multiple sources
- **Agent Orchestration Engine**: Receives the provisioned construct and assembled prompt for session initialization
- **Persistence Layer**: Stores construct metadata and provisioning state

## Testing Strategy
- Test template selection and validation workflows, including missing fields and invalid template IDs.
- Verify workspace directory creation and prompt bundle persistence during provisioning.
- Exercise service startup with mocked commands to ensure port allocation and environment injection behave as expected.
- Validate error handling paths when templates are missing or services fail to start.
