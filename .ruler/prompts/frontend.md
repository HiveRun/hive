# Frontend Guidelines

## Framework & Architecture

This project uses **TanStack Start** (React-based meta-framework) with:
- File-based routing in `apps/web/src/routes/`
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

Components are stored in `apps/web/src/components/ui/`

## Styling

- **Tailwind CSS** for styling
- Dark mode via `next-themes`
- Component variants using `class-variance-authority` (cva)

## Backend Communication

The backend is a separate **Elysia** server with a type-safe RPC client.

### Query Factories Pattern

Define queries in centralized factory files (`src/queries/`) instead of inline.

Benefits: Type-safe, reusable, prevents queryKey typos, easier cache invalidation.

**Example pattern:**

```tsx
// src/queries/users.ts
export const userQueries = {
  all: () => ({
    queryKey: ["users"] as const,
    queryFn: () => rpcClient.users.list(),
  }),

  detail: (id: string) => ({
    queryKey: ["users", id] as const,
    queryFn: () => rpcClient.users.get(id),
  }),
};

export const userMutations = {
  create: {
    mutationFn: (data: CreateUserInput) => rpcClient.users.create(data),
  },
};
```

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

## Error Handling

### Global Error Component

Global error and loading states configured in `src/router.tsx`:
- `defaultErrorComponent` - Shown when route loaders fail
- `defaultPendingComponent` - Shown while route loaders run

**Implementation:** `src/components/error.tsx` and `src/components/loader.tsx`

Override per-route only when special handling is needed via `errorComponent` option.

### Mutation Errors

For user action failures, use toast notifications:

```tsx
const mutation = useMutation({
  mutationFn: rpcClient.users.create,
  onError: (error) => {
    toast.error(error.message ?? 'Failed to create user')
  },
  onSuccess: () => {
    toast.success('User created successfully')
  }
})
```

**We use sonner for toasts** - already installed and configured.

### Form Validation Errors

Display field-level errors inline with TanStack Form:

```tsx
<form.Field name="email">
  {(field) => (
    <>
      <input {...field.getInputProps()} />
      {field.state.meta.errors && (
        <span className="text-sm text-destructive">
          {field.state.meta.errors[0]}
        </span>
      )}
    </>
  )}
</form.Field>
```

## Loading States

### Route-Level Loading

Loading states handled automatically by `defaultPendingComponent` in router.

Override per-route for custom skeletons:

```tsx
export const Route = createFileRoute('/users')({
  loader: ...,
  pendingComponent: () => <UsersTableSkeleton />
})
```

### Component-Level Loading

For component-specific async operations:

```tsx
const { data, isPending } = useQuery(userQueries.all())

if (isPending) return <Skeleton />

return <UsersList data={data} />
```

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

**Implementation:** `src/lib/storage.ts`

```tsx
import { storage } from '@/lib/storage'

// Usage
const draft = storage.get<PostFormData>('post-draft')
storage.set('theme', 'dark')
storage.remove('post-draft')
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

### Optimistic Updates

For instant UI feedback during mutations:

```tsx
const mutation = useMutation({
  mutationFn: rpcClient.posts.update,
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['posts'] })

    // Snapshot previous value for rollback
    const previous = queryClient.getQueryData(['posts'])

    // Optimistically update cache
    queryClient.setQueryData(['posts'], (old) =>
      old.map(p => p.id === newData.id ? newData : p)
    )

    return { previous }
  },
  onError: (_err, _vars, context) => {
    // Rollback on error
    queryClient.setQueryData(['posts'], context.previous)
    toast.error('Failed to update post')
  },
  onSettled: () => {
    // Refetch to ensure sync with server
    queryClient.invalidateQueries({ queryKey: ['posts'] })
  }
})
```

**Benefits:**
- Instant UI feedback
- Automatic rollback on error
- Server sync on success

### TanStack Query Cache Persistence (Optional)

For offline-first apps, persist the query cache:

```tsx
// src/router.tsx
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
