# API & Backend Patterns

## Tech Stack

- **Framework**: Elysia (TypeScript backend framework built on Bun)
- **Database**: Drizzle ORM with SQLite (local) / PostgreSQL (production)
- **Validation**: Elysia's built-in TypeBox validation
- **Logging**: @bogeychan/elysia-logger + pino-pretty

## Validation

**ALWAYS use Elysia's built-in validation with TypeBox** for all API endpoints that accept input.

### Example: POST endpoint with validation

```typescript
import { Elysia, t } from 'elysia'

app.post('/api/notes', async ({ body, set }) => {
  // body is automatically typed and validated
  const note = await db.insert(notes).values(body).returning()
  return note[0]
}, {
  body: t.Object({
    title: t.String({ minLength: 1, maxLength: 100 }),
    content: t.String(),
    isPublished: t.Optional(t.Boolean())
  })
})
```

### Example: GET endpoint with query params

```typescript
app.get('/api/notes', async ({ query }) => {
  const limit = query.limit || 10
  return await db.query.notes.findMany({ limit })
}, {
  query: t.Object({
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100 }))
  })
})
```

### Example: Path parameters

```typescript
app.get('/api/notes/:id', async ({ params, error }) => {
  const note = await db.query.notes.findFirst({
    where: eq(notes.id, params.id)
  })

  if (!note) {
    return error(404, 'Note not found')
  }

  return note
}, {
  params: t.Object({
    id: t.Number()
  })
})
```

## Error Handling

Use Elysia's error helper for consistent error responses:

```typescript
app.post('/api/notes', async ({ body, error }) => {
  if (someCondition) {
    return error(400, 'Validation failed: title is required')
  }

  if (unauthorized) {
    return error(401, 'Unauthorized')
  }

  if (notFound) {
    return error(404, 'Resource not found')
  }

  // Success response
  return { success: true, data }
})
```

## Type Safety

Elysia automatically generates TypeScript types from validation schemas. These types are consumed by Eden Treaty on the frontend for end-to-end type safety.

**No need for manual type definitions** - TypeBox validation IS your type definition.

## Database Patterns

Use Drizzle ORM for all database operations:

```typescript
import { db } from '@synthetic/db'
import { notes } from '@synthetic/db/schema'
import { eq } from 'drizzle-orm'

// Insert
const newNote = await db.insert(notes).values({ title, content }).returning()

// Query
const allNotes = await db.query.notes.findMany()
const note = await db.query.notes.findFirst({ where: eq(notes.id, id) })

// Update
await db.update(notes).set({ title, content }).where(eq(notes.id, id))

// Delete
await db.delete(notes).where(eq(notes.id, id))
```

## API Organization

Group related endpoints:

```typescript
const notesApi = new Elysia({ prefix: '/api/notes' })
  .get('/', listNotes)
  .post('/', createNote)
  .get('/:id', getNote)
  .put('/:id', updateNote)
  .delete('/:id', deleteNote)

app.use(notesApi)
```

## Logging

All requests are automatically logged by @bogeychan/elysia-logger. No need to add manual logging for standard CRUD operations.

Add custom logs for important business logic:

```typescript
app.post('/api/notes', async ({ body, log }) => {
  log.info({ noteId: result.id }, 'Note created successfully')
  return result
})
```
