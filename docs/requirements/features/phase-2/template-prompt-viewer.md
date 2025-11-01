# Template Prompt Viewer

## Goal
Allow operators to inspect the final prompt bundle generated for a construct template before launching it. This includes the concatenated prompt fragments and an estimated token count.

## Key Requirements
- Display the ordered list of prompt fragments (`promptSources` + template-specific prompts).
- Compute token estimates using the active model’s tokenizer.
- Highlight large sections or potential redundancies so users can trim context before launch.
- Integrate with the construct creation flow (e.g., a "View prompts" modal).
