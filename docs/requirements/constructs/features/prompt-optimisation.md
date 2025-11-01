# Prompt Optimisation

## Goal
Analyse prompt bundles to minimise redundant context, reduce token usage, and improve agent responsiveness.

## Key Requirements
- Measure token counts per fragment and total for each template/run.
- Detect repeated or overlapping content (e.g., duplicated instructions) and suggest removal.
- Highlight large sections that rarely change so they can be moved to shared context.
- Provide "what-if" estimates when editing prompts (e.g., token delta after modification).
