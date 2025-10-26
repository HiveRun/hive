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

### Data Fetching Pattern

Use **TanStack Query** with the RPC client for all backend communication:

```tsx
"use client"

const { data, isLoading } = useQuery({
  queryKey: ['resource'],
  queryFn: () => rpcClient.resource.get()
})
```

This provides:
- End-to-end type safety via RPC client
- Automatic caching and revalidation
- Optimistic updates and mutations
- Better devtools support

### When to Use Server vs Client Components

- **Client components** (`"use client"`) - Default for data fetching and interactivity
- **Server components** - Static content, initial page shells, SEO-critical pages

Since the backend is separate, there's no benefit to fetching data in server components - both require HTTP calls.

## State Management

- **TanStack Query** - All server state (via RPC client)
- **Local state** (`useState`/`useReducer`) - UI state, forms, toggles

## Component Structure

```tsx
"use client"

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
- Default to client components for data fetching
- Keep components small and focused
- Colocate related components in feature directories when appropriate
