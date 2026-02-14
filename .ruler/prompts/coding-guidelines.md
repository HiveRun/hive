# Coding Guidelines

## Tooling & Workflow

- Install dependencies from the repo root with `bun install`; workspace-aware scripts resolve packages automatically.
- Start dev servers using `bun run dev`, or target `bun run dev:web` / `bun run dev:server` when you only need one side.
- Run `bun run check:commit` before committing and `bun run check:push` before pushing; the latter enforces the Playwright E2E suite (`bun run test:e2e`).
- Build the workspace with `bun run build` and rely on package-level `bun -C apps/* run build` only for scoped verifications.
- Lint/format via `bun run check:biome` or each package's `bun -C <dir> run check` script; Biome applies fixes in place.
- Husky hooks enforce the check pipeline automatically—do not skip or rewrite them.

## Runtime Patterns
- Backend and CLI runtime code is Promise-first. Use `async`/`await` with small factory services and explicit dependencies.
- Keep shared orchestration in focused helper modules (service supervisors, registry helpers, worktree manager), then call them directly from routes/commands.
- Prefer deterministic wrappers for external boundaries (filesystem, child processes, network calls) so tests can stub behavior cleanly.
- Do not introduce new Effect/@effect dependencies or language-service tooling.

## Programming Style

**Prefer functional and declarative approaches** where possible. This makes code more predictable, testable, and easier to reason about.

**Use imperative approaches** when functional/declarative patterns don't fit the problem or would add unnecessary complexity.

**ALWAYS use factory functions over classes** - Return objects with methods instead of using `class` and `new`. Factory functions are simpler, more flexible, and avoid `this` complexity.

**NEVER use classes** - Do not create classes with `class` keyword or instantiate with `new`. Always prefer factory functions that return objects with methods. This is a strict rule for this codebase.

**Trust the TypeScript types** for internal code paths; skip redundant runtime guards when the compiler already guarantees the shape. Reserve extra validation for external or untyped inputs, and when you do need it lean on dedicated schemas (TypeBox, Zod, etc.) instead of ad-hoc checks.

**Avoid redundant runtime validation tests** - If TypeScript catches an error at compile time (requiring `@ts-expect-error` to test), don't write a runtime test for it. The type system already validates it.

## Code Organization

**No barrel files** - Avoid `index.ts` files that just re-export. Import directly from source files instead. Barrel files slow tree-shaking, create larger bundles, and make imports harder to trace.

**No unnecessary comments** - Code should be self-documenting through clear naming. Only add comments when explaining *why* something is done a certain way, not *what* it does. If you need a comment to explain *what* code does, improve the naming instead.

## Error Handling

**Handle errors where you can do something reasonable about them.** Don't catch errors just to re-throw them or log without context.

**Prefer `neverthrow` Results over `try`/`catch`.** Reach for `Result`/`ResultAsync` helpers (or shared wrappers like `safeSync`/`safeAsync`) so callers must explicitly unwrap errors. Only use `try`/`catch` when there is no alternative (e.g., synchronous APIs that throw and must not crash the process).

**Prioritize visibility** - ensure errors surface clearly where they occur. Stack traces and context are more valuable than silent failures.

**Avoid overbearing error handling** that adds no value. Let errors bubble up to where they can be meaningfully addressed.

**Don't create custom Error classes** - Just throw `new Error("message")`. Custom error classes add complexity without benefit. If you need to distinguish error types, use error messages or codes.
