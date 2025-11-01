# Service Control

## Goal
Provide comprehensive service management capabilities for both users and agents through UI, CLI, and MCP tools.

## Key Requirements
- Record running service state (command, cwd, env, last-known status, pid if available).
- On startup, Synthetic should detect constructs marked active, probe each recorded PID with `kill -0` (does not terminate the process) to see which services survived.
- Mark any missing processes as `needs_resume`. A construct's displayed status is derived from these state flags.
- If anything needs attention, the UI surfaces a "Resume construct" CTA (with optional granular controls).
- Expose service control through both CLI/MCP tools (`list`, `stop`, `restart`, `resume`) so agents and humans can bounce services programmatically.
- Make it easy to copy the exact command/env that the supervisor uses (e.g., `synthetic services info <construct> <service>` prints the command) so users can run it manually if needed.
- Agent sessions should persist transcripts/context so a fresh OpenCode session can be created after restart.
- Present a "Resume agent" button that replays the composed prompt before sending any new user input.