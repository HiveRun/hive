# Coding Guidelines

## Programming Style

**Prefer functional and declarative approaches** where possible. This makes code more predictable, testable, and easier to reason about.

**Use imperative approaches** when functional/declarative patterns don't fit the problem or would add unnecessary complexity.

## Error Handling

**Handle errors where you can do something reasonable about them.** Don't catch errors just to re-throw them or log without context.

**Prioritize visibility** - ensure errors surface clearly where they occur. Stack traces and context are more valuable than silent failures.

**Avoid overbearing error handling** that adds no value. Let errors bubble up to where they can be meaningfully addressed.
