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

**Use factory functions over classes** - Return objects with methods instead of using `class` and `new`. Factory functions are simpler, more flexible, and avoid `this` complexity.

**Trust the TypeScript types** for internal code paths; skip redundant runtime guards when the compiler already guarantees the shape. Reserve extra validation for external or untyped inputs, and when you do need it lean on dedicated schemas (TypeBox, Zod, etc.) instead of ad-hoc checks.

**Avoid redundant runtime validation tests** - If TypeScript catches an error at compile time (requiring `@ts-expect-error` to test), don't write a runtime test for it. The type system already validates it.

## Code Organization

**No barrel files** - Avoid `index.ts` files that just re-export. Import directly from source files instead. Barrel files slow tree-shaking, create larger bundles, and make imports harder to trace.

**No unnecessary comments** - Code should be self-documenting through clear naming. Only add comments when explaining *why* something is done a certain way, not *what* it does. If you need a comment to explain *what* code does, improve the naming instead.

## Error Handling

**Handle errors where you can do something reasonable about them.** Don't catch errors just to re-throw them or log without context.

**Prioritize visibility** - ensure errors surface clearly where they occur. Stack traces and context are more valuable than silent failures.

**Avoid overbearing error handling** that adds no value. Let errors bubble up to where they can be meaningfully addressed.

**Don't create custom Error classes** - Just throw `new Error("message")`. Custom error classes add complexity without benefit. If you need to distinguish error types, use error messages or codes.


