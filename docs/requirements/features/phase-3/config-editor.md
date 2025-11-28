# Configuration Editor

- [ ] Configuration Editor #status/planned #phase-3 #feature/advanced

## Goal
Provide a guided UI for editing `hive.config.ts` (or a future companion format) with validation and guardrails.

## Key Requirements
- Present workspace settings, templates, and prompt sources in structured forms.
- Validate inputs (e.g., env var references, service commands) before writing changes.
- Respect version control: commits should capture edits; diffs should remain readable.
- Explore generating a typed intermediate format (e.g., JSON/YAML) that can be transformed into the TS config.
