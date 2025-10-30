# Coding Guidelines

## Tooling & Workflow

- Install dependencies from the repo root with `bun install`; workspace-aware scripts resolve packages automatically.
- Start dev servers using `bun run dev`, or target `bun run dev:web` / `bun run dev:server` when you only need one side.
- Run `bun run check:commit` before committing and `bun run check:push` before pushing; the latter adds Playwright snapshots.
- Build the workspace with `bun run build` and rely on package-level `bun -C apps/* run build` only for scoped verifications.
- Lint/format via `bun run check:biome` or each package's `bun -C <dir> run check` script; Biome applies fixes in place.
- Husky hooks enforce the check pipeline automatically—do not skip or rewrite them.

## Programming Style

**Prefer functional and declarative approaches** where possible. This makes code more predictable, testable, and easier to reason about.

**Use imperative approaches** when functional/declarative patterns don't fit the problem or would add unnecessary complexity.

**Trust the TypeScript types** for internal code paths; skip redundant runtime guards when the compiler already guarantees the shape. Reserve extra validation for external or untyped inputs, and when you do need it lean on dedicated schemas (TypeBox, Zod, etc.) instead of ad-hoc checks.

## Error Handling

**Handle errors where you can do something reasonable about them.** Don't catch errors just to re-throw them or log without context.

**Prioritize visibility** - ensure errors surface clearly where they occur. Stack traces and context are more valuable than silent failures.

**Avoid overbearing error handling** that adds no value. Let errors bubble up to where they can be meaningfully addressed.
