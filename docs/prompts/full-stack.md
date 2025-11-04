# Full Stack Development Guidance

- Start the web client (`bun run dev:web`) and API server (`bun run dev:server`) before testing changes.
- Keep the UI and API contracts in sync; update TypeScript types in both apps when modifying shared data.
- Ensure database migrations are idempotent and checked into version control.
