# Frontend Guidelines

## Framework & Architecture

This project uses **TanStack Start** (React-based meta-framework) with:
- File-based routing in `apps/web/app/routes/`
- Server-side rendering (SSR) by default
- Type-safe routing with TanStack Router

## UI Components - shadcn/ui

We use **shadcn/ui** for UI components.

### Adding Components

```bash
# From monorepo root
cd apps/web
npx shadcn@latest add <component-name>
```

Components are stored in `apps/web/app/components/ui/`

## Styling

- **Tailwind CSS** for styling
- Dark mode via `next-themes`
- Component variants using `class-variance-authority` (cva)

## Backend Communication

The backend is a separate **Elysia** server with a type-safe RPC client.

### Query Factories Pattern

Define queries in centralized factory files instead of inline:

```tsx
// src/queries/users.ts
export const userQueries = {
  all: () => ({
    queryKey: ['users'],
    queryFn: () => rpcClient.users.list()
  }),
  detail: (id: string) => ({
    queryKey: ['users', id],
    queryFn: () => rpcClient.users.get(id)
  }),
  search: (term: string) => ({
    queryKey: ['users', 'search', term],
    queryFn: () => rpcClient.users.search(term)
  })
}

// In component
const { data } = useQuery(userQueries.all())
```

Benefits: Type-safe, reusable, prevents queryKey typos, easier invalidation.

### Route-Level Data Loading

**Prefer route loaders over component-level queries.** Put state in the URL and let loaders handle it:

```tsx
// src/routes/users.tsx
export const Route = createFileRoute('/users')({
  validateSearch: z.object({
    search: z.string().optional(),
    page: z.number().default(1)
  }),
  loader: ({ context: { queryClient }, search }) =>
    queryClient.ensureQueryData(userQueries.search(search.search))
})

function Users() {
  const { search } = Route.useSearch()
  // Uses cached data from loader - no loading spinner flash
  const { data } = useQuery(userQueries.search(search.search))
}
```

**Why route loaders:**
- Data loads before component mounts
- Shareable/bookmarkable URLs
- Browser back/forward works correctly
- Better perceived performance

## State Management & Persistence

### Persistence Strategy

**If state matters to the user, persist it somewhere.**

**URL Search Params** - "What am I viewing?"
- Filters, search, sort order, pagination
- Selected tabs/sections that affect content
- Any state that should be shareable via URL

**localStorage** - "What am I creating/editing?"
- Form drafts (auto-saved)
- User preferences (theme, sidebar state)
- UI state that should persist across sessions

**Component State** - Truly ephemeral
- Hover/focus states
- Mid-animation states
- Tooltip visibility

### Type-Safe localStorage Wrapper

```tsx
// src/lib/storage.ts
export const storage = {
  get: <T>(key: string): T | null => {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : null
  },
  set: <T>(key: string, value: T) => {
    localStorage.setItem(key, JSON.stringify(value))
  },
  remove: (key: string) => localStorage.removeItem(key)
}

// Usage
const draft = storage.get<PostFormData>('post-draft')
storage.set('theme', 'dark')
```

### Form Draft Pattern

Auto-save form drafts to localStorage:

```tsx
const form = useForm({
  defaultValues: () => {
    const draft = storage.get<FormData>('post-draft')
    return draft ?? { title: '', content: '' }
  },
  onSubmit: async ({ value }) => {
    await rpcClient.posts.create(value)
    storage.remove('post-draft') // Clear on success
  }
})

// Auto-save draft
useEffect(() => {
  const subscription = form.store.subscribe(() => {
    storage.set('post-draft', form.state.values)
  })
  return subscription
}, [])
```

### TanStack Query Cache Persistence (Optional)

For offline-first apps, persist the query cache:

```tsx
// src/app/router.tsx
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

const persister = createSyncStoragePersister({
  storage: window.localStorage
})

// Wrap app
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister }}
>
  {/* app */}
</PersistQueryClientProvider>
```

**Use cases:**
- Reduce API calls on page reload
- Offline-first functionality
- Faster perceived performance

**Note:** This is different from localStorage for drafts/preferences. This caches server responses.

## Component Structure

```tsx
interface ButtonProps {
  variant?: "default" | "destructive"
  children: React.ReactNode
}

export const Button = ({ variant = "default", children }: ButtonProps) => {
  return <button className={cn(variants[variant])}>{children}</button>
}
```

## Best Practices

- Use TypeScript for all components
- Keep components small and focused
- Colocate related components in feature directories when appropriate
