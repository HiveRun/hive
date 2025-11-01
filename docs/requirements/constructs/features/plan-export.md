# Plan Export

## Goal
Let users push planning outcomes to external systems (Linear, GitHub Issues, etc.) directly from Synthetic.

## Key Requirements
- Provide an action after plan approval to export the plan summary and artefacts.
- Support multiple destinations (configurable per workspace) with templated payloads.
- Record export history so the construct shows which external items were created.
- Handle authentication via existing integrations (Linear, GitHub) or generic webhooks.
