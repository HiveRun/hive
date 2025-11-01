# Construct Features Roadmap

This directory captures individual feature briefs referenced from the main construct overview. Each entry notes the desired phase for delivery so we can tackle work incrementally.

| Feature | Phase | Summary |
| --- | --- | --- |
| [Template Prompt Viewer](template-prompt-viewer.md) | Phase 1 | Preview concatenated prompts and token counts before launching a construct. |
| [Cross-Construct Search](cross-construct-search.md) | Phase 1 | Search transcripts, logs, and artifacts across constructs. |
| [Metrics Baseline](metrics-baseline.md) | Phase 1 | Track per-construct timing and intervention counts. |
| [Inline Prompt Editor](inline-prompt-editor.md) | Phase 2 | Edit prompt fragments (`docs/prompts/**/*.md`) directly in Synthetic. |
| [Linear Integration](linear-integration.md) | Phase 2 | Create constructs from Linear issues and sync status back. |
| [Voice Input](voice-input.md) | Phase 3 | Push-to-talk for agent conversations. |
| [Insight Analytics](insight-analytics.md) | Phase 3 | Trend reporting on construct performance. |
| [GitHub Integration](github-integration.md) | Phase 3 | Start constructs from branches, sync PRs. |
| [Plan Export](plan-export.md) | Phase 3 | Push plan artifacts to external trackers (Linear, GitHub, etc.). |
| [Prompt Optimisation](prompt-optimisation.md) | Phase 3 | Analyse prompt bundles for redundant context/token bloat. |
| [Sparse Constructs](sparse-constructs.md) | Phase 3 | Run agent-only constructs without services. |
| [Reference Repos](reference-repos.md) | Phase 3 | Attach remote repositories as read-only references. |
| [Compaction Logging](compaction-logging.md) | Phase 3 | Surface agent compaction events and token loss. |
| [Terminal UI](terminal-ui.md) | Phase 3 | Provide a TUI front-end using OpenTUI. |
| [Configuration Editor](config-editor.md) | Phase 3 | UI for editing `synthetic.config.ts` (or companion format). |

> _Phase definitions:_
> - **Phase 1** – Post-MVP foundations.
> - **Phase 2** – Collaboration & governance improvements.
> - **Phase 3** – Advanced interaction and tooling.
