# Configuration Validation

## Goal
Provide comprehensive validation and linting for `synthetic.config.ts` and related configuration files to catch errors before provisioning constructs.

## Key Requirements

### Schema Validation
- **TypeScript compilation**: Compile the TS config file on-the-fly to catch syntax errors and type mismatches.
- **Schema compliance**: Validate that the exported config matches the expected `SyntheticConfig` schema.
- **Required fields**: Ensure all required fields are present and properly typed.
- **Enum validation**: Validate that enum values (construct types, service types) match allowed values.

### Path Validation
- **File existence**: Verify that all referenced files and directories exist (prompt sources, template files, compose files).
- **Path resolution**: Resolve relative paths against the workspace root correctly.
- **Glob expansion**: Validate that glob patterns match actual files and don't expand to empty sets.
- **Permission checks**: Ensure Synthetic has read permissions for all referenced files.

### Template Validation
- **Service configuration**: Validate each service definition for required fields and valid combinations.
- **Port conflicts**: Detect potential port conflicts within templates and suggest alternatives.
- **Environment variables**: Validate environment variable references and detect undefined variables.
- **Command validation**: Basic validation of command syntax and executable availability.

### Cross-Reference Validation
- **Prompt source integrity**: Ensure prompt sources don't create circular references.
- **Template references**: Validate that template-scoped prompts reference existing files.
- **Dependency checking**: Verify that required tools (Docker, compose) are available for declared service types.
- **Workspace consistency**: Check that the config is consistent with the actual workspace structure.

### CLI Integration
- **Lint command**: Expose `synthetic config lint` CLI that performs all validations and reports issues.
- **Pre-provisioning checks**: Automatically run validation before construct provisioning with clear error messages.
- **IDE integration**: Provide language server or VS Code extension for real-time validation feedback.
- **CI integration**: Support for validation in CI/CD pipelines.

### Error Reporting
- **Clear error messages**: Provide actionable error messages with file locations and suggested fixes.
- **Warning system**: Distinguish between blocking errors and warnings that should be addressed but don't prevent operation.
- **Validation reports**: Generate detailed validation reports for complex configurations.
- **Fix suggestions**: Offer automatic fixes or suggestions for common configuration issues.

## Integration Points
- **Template Definition System**: Validates template structure and service definitions
- **Prompt Assembly Pipeline**: Validates prompt source paths and references
- **Agent Orchestration Engine**: Ensures required agent configuration is present
- **Docker & Compose Support**: Validates container-specific configurations