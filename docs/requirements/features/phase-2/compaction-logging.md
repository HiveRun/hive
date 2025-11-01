# Compaction Logging

- [ ] Compaction Logging #status/planned #phase-2 #feature/advanced

## Goal
Increase transparency around agent compaction events so users can understand context loss over long sessions.

## Key Requirements
- Detect when the underlying provider performs prompt compaction/truncation (via OpenCode events or token counts).
- Log each compaction with metadata (token delta, reason) and surface it in the chat timeline.
- Provide warnings when compaction risk is high and suggest manual summarisation.
- Offer exportable summaries so teams can monitor compaction trends over time.
