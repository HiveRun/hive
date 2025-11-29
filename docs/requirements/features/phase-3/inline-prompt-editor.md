# Inline Prompt Editor

- [ ] Inline Prompt Editor #status/planned #phase-3 #feature/advanced

## Goal
Offer an optional rich markdown editor for prompt fragments so users can adjust agent guidance without leaving Hive.

## Key Requirements
- List all prompt files sourced from `promptSources` and template-specific prompts.
- Provide syntax-highlighted editing with validation (linting for token count, placeholder usage).
- Respect version control: write changes back to the repo and highlight diffs.
- Consider role-based access or warnings to avoid unintended prompt drift.
