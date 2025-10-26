# synthetic

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Start, Elysia, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Elysia** - Type-safe, high-performance framework
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **SQLite/Turso** - Database engine
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```
## Database Setup

This project uses SQLite with Drizzle ORM.

1. Start the local SQLite database:
```bash
cd apps/server && bun db:local
```


2. Update your `.env` file in the `apps/server` directory with the appropriate connection details if needed.

3. Apply the schema to your database:
```bash
bun db:push
```


Then, run the development server:

```bash
bun dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).







## Project Structure

```
synthetic/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Start)
│   └── server/      # Backend API (Elysia)
├── packages/
│   ├── api/         # API layer / business logic
```

## Testing

This project uses a **hybrid testing philosophy**:

### Backend Unit Tests (Vitest)
API and business logic tested with Vitest.

```bash
# Run unit tests in watch mode
bun test

# Run unit tests once (CI mode)
bun test:run
```

**Test location:** `apps/server/src/**/*.test.ts`

### UI Testing (Playwright + Visual Snapshots)
All UI testing is done through **E2E tests with visual regression testing**. No component unit tests - UI correctness is validated through snapshots across multiple viewports and themes.

```bash
# Run E2E tests
bun test:e2e

# Run with interactive UI (debugging)
bun test:e2e:ui

# Update visual snapshots (after intentional UI changes)
bun test:e2e:update-snapshots
```

**Test location:** `apps/web/e2e/*.spec.ts`

**Snapshot coverage:**
- Light/Dark mode
- Desktop/Tablet/Mobile viewports
- All key user flows

### Git Hooks & Validation

**Pre-commit** (`bun run check:commit`):
- Linting (Biome)
- Type checking (TypeScript)
- Unit tests (Vitest)
- Security checks (secrets detection, dependency audit)
- Build validation

**Pre-push** (`bun run check:push`):
- Everything from pre-commit
- E2E tests (Playwright with visual snapshots)

## Available Scripts

### Development
- `bun dev`: Start all applications in development mode
- `bun dev:web`: Start only the web application
- `bun dev:server`: Start only the server

### Building
- `bun build`: Build all applications

### Testing
- `bun test`: Run unit tests in watch mode
- `bun test:run`: Run unit tests once (CI mode)
- `bun test:e2e`: Run E2E tests
- `bun test:e2e:ui`: Run E2E tests with interactive UI
- `bun test:e2e:headed`: Run E2E tests in headed mode (see browser)
- `bun test:e2e:update-snapshots`: Update visual snapshots

### Quality Checks
- `bun check`: Run all pre-commit checks (alias for `check:commit`)
- `bun check:commit`: Run all pre-commit checks (~5-10s)
- `bun check:push`: Run all pre-push checks (~30-60s with E2E tests)
- `bun check-types`: Check TypeScript types across all apps

### Database
- `bun db:push`: Push schema changes to database
- `bun db:studio`: Open database studio UI
- `cd apps/server && bun db:local`: Start the local SQLite database
