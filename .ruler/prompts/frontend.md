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

The backend is a separate **Elysia** server. Communication happens via **Eden Treaty RPC** which provides end-to-end type safety.

**ALWAYS import from `@/lib/rpc`:**

```typescript
import { rpc } from "@/lib/rpc"
```

Eden Treaty provides automatic TypeScript inference from your Elysia backend. No manual typing needed.

### Eden Treaty Usage

```typescript
// GET request
const { data, error } = await rpc.api.users.get()
if (error) throw new Error("Failed to fetch users")
return data

// POST request with body
const { data, error } = await rpc.api.users.post({
  name: "John",
  email: "john@example.com"
})

// Path parameters
const { data, error } = await rpc.api.users({ id: "123" }).get()

// Query parameters
const { data, error } = await rpc.api.users.get({
  query: { limit: 10, page: 2 }
})
```

### Query Factories Pattern

**ALWAYS define queries in centralized factory files** (`src/queries/`) instead of inline.

Benefits: Type-safe, reusable, prevents queryKey typos, easier cache invalidation.

**Example pattern:**

```tsx
// src/queries/users.ts
import { rpc } from "@/lib/rpc"

export const userQueries = {
  all: () => ({
    queryKey: ["users"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.users.get()
      if (error) throw new Error("Failed to fetch users")
      return data
    },
  }),

  detail: (id: string) => ({
    queryKey: ["users", id] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.users({ id }).get()
      if (error) throw new Error("User not found")
      return data
    },
  }),
}

export const userMutations = {
  create: {
    mutationFn: async (input: CreateUserInput) => {
      const { data, error } = await rpc.api.users.post(input)
      if (error) throw new Error("Failed to create user")
      return data
    },
  },
}
```

## Forms

**ALWAYS use TanStack Form with shadcn/ui components for forms.** This provides type-safe, accessible forms with powerful validation.

### Installation

```bash
cd apps/web
npx shadcn@latest add form
bun add @tanstack/react-form
```

### Basic Form Pattern

```tsx
import { useForm } from '@tanstack/react-form'
import { zodValidator } from '@tanstack/zod-form-adapter'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { rpc } from '@/lib/rpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

const userSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  age: z.number().min(18, 'Must be 18 or older').optional()
})

type UserFormData = z.infer<typeof userSchema>

function UserForm() {
  const mutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const { data: user, error } = await rpc.api.users.post(data)
      if (error) throw new Error('Failed to create user')
      return user
    },
    onSuccess: () => {
      toast.success('User created successfully')
      form.reset()
    },
    onError: (error) => {
      toast.error(error.message)
    }
  })

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      age: undefined
    },
    validatorAdapter: zodValidator(),
    validators: {
      onChange: userSchema
    },
    onSubmit: async ({ value }) => {
      mutation.mutate(value)
    }
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <form.Field name="name">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive mt-1">
                {field.state.meta.errors[0]}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="email">
        {(field) => (
          <div>
            <Label htmlFor={field.name}>Email</Label>
            <Input
              id={field.name}
              type="email"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive mt-1">
                {field.state.meta.errors[0]}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating...' : 'Create User'}
      </Button>
    </form>
  )
}
```

### Form Field Patterns

**Text Input:**
```tsx
<form.Field name="username">
  {(field) => (
    <div>
      <Label htmlFor={field.name}>Username</Label>
      <Input
        id={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
      )}
    </div>
  )}
</form.Field>
```

**Select Dropdown:**
```tsx
<form.Field name="role">
  {(field) => (
    <div>
      <Label htmlFor={field.name}>Role</Label>
      <Select
        value={field.state.value}
        onValueChange={field.handleChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="user">User</SelectItem>
        </SelectContent>
      </Select>
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
      )}
    </div>
  )}
</form.Field>
```

**Checkbox:**
```tsx
<form.Field name="agreedToTerms">
  {(field) => (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={field.name}
        checked={field.state.value}
        onCheckedChange={field.handleChange}
      />
      <Label htmlFor={field.name}>I agree to the terms and conditions</Label>
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
      )}
    </div>
  )}
</form.Field>
```

**Textarea:**
```tsx
<form.Field name="description">
  {(field) => (
    <div>
      <Label htmlFor={field.name}>Description</Label>
      <Textarea
        id={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
      )}
    </div>
  )}
</form.Field>
```

### Auto-Save Form Drafts

Combine with localStorage to automatically save form drafts:

```tsx
import { storage } from '@/lib/storage'
import { useEffect } from 'react'

function PostForm() {
  const form = useForm({
    defaultValues: () => {
      const draft = storage.get<PostFormData>('post-draft')
      return draft ?? { title: '', content: '' }
    },
    validatorAdapter: zodValidator(),
    validators: {
      onChange: postSchema
    },
    onSubmit: async ({ value }) => {
      const { data, error } = await rpc.api.posts.post(value)
      if (error) throw new Error('Failed to create post')
      storage.remove('post-draft') // Clear on success
      toast.success('Post created!')
      return data
    }
  })

  // Auto-save draft on change
  useEffect(() => {
    const subscription = form.store.subscribe(() => {
      storage.set('post-draft', form.state.values)
    })
    return subscription
  }, [])

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
      {/* form fields */}
    </form>
  )
}
```

### Validation Strategies

**onChange validation** - Validate as user types (best for instant feedback):
```tsx
const form = useForm({
  validators: {
    onChange: userSchema
  }
})
```

**onBlur validation** - Validate when field loses focus (less noisy):
```tsx
const form = useForm({
  validators: {
    onBlur: userSchema
  }
})
```

**onSubmit validation** - Validate only on submit (least intrusive):
```tsx
const form = useForm({
  validators: {
    onSubmit: userSchema
  }
})
```

### Accessibility Requirements

Always include these attributes for proper accessibility:

```tsx
<Input
  id={field.name}
  aria-invalid={field.state.meta.errors.length > 0}
  aria-describedby={field.state.meta.errors.length > 0 ? `${field.name}-error` : undefined}
/>
{field.state.meta.errors.length > 0 && (
  <p id={`${field.name}-error`} className="text-sm text-destructive">
    {field.state.meta.errors[0]}
  </p>
)}
```

### Route-Level Data Loading

**ALWAYS prefer route loaders over component-level queries.** Put state in the URL and let loaders handle it.

**ALWAYS use `validateSearch` with Zod schemas** for type-safe search params:

```tsx
// src/routes/users.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { userQueries } from '@/queries/users'

// Define search param schema
const userSearchSchema = z.object({
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  status: z.enum(['active', 'inactive']).optional()
})

export const Route = createFileRoute('/users')({
  validateSearch: userSearchSchema,
  loader: ({ context: { queryClient }, search }) =>
    queryClient.ensureQueryData(userQueries.list(search))
})

function Users() {
  const search = Route.useSearch() // Fully typed from Zod schema!
  // Uses cached data from loader - no loading spinner flash
  const { data } = useSuspenseQuery(userQueries.list(search))

  return <UsersList users={data} currentPage={search.page} />
}
```

**Why route loaders + search validation:**
- Data loads **before** component mounts (no loading flicker)
- Search params are validated and typed automatically
- Invalid params are caught at runtime
- Shareable/bookmarkable URLs with guaranteed valid state
- Browser back/forward works correctly
- Better perceived performance

**Key pattern: `useSuspenseQuery` instead of `useQuery`**

When using loaders, use `useSuspenseQuery` in components:
- No need for `isPending` checks
- No loading state JSX
- Data is guaranteed to be available
- Loading handled by router's `defaultPendingComponent`

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
