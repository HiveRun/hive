# Backend Patterns

## Tech Stack

- **Framework**: Elysia (TypeScript backend framework built on Bun)
- **Database**: Drizzle ORM with SQLite (local) / PostgreSQL (production)
- **Validation**: Elysia's built-in TypeBox validation
- **Logging**: @bogeychan/elysia-logger + pino-pretty

## Key Patterns

**ALWAYS use TypeBox validation** for all API endpoints that accept input:
- `body: t.Object({...})` for POST/PUT requests
- `query: t.Object({...})` for query parameters
- `params: t.Object({...})` for path parameters

**Error handling**: Use Elysia's `error(statusCode, message)` helper for consistent error responses.

**Type safety**: Eden Treaty consumes Elysia types automatically for end-to-end type safety. No need for manual type definitions - TypeBox validation IS your type definition.

**Database**: Use Drizzle ORM for all database operations (`db.insert()`, `db.query.table.findMany()`, `db.update()`, `db.delete()`).

**Transactions**: Multi-step operations that must succeed or fail together MUST use `db.transaction()`.

**Design for rollback**: Operations modifying multiple resources should be designed to be reversible or compensatable.

**Logging**: All requests are automatically logged via @bogeychan/elysia-logger. Only add custom logs (`log.info()`, `log.error()`) for important business logic.
