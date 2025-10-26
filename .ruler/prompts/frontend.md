# Frontend Guidelines

## Framework & Architecture

This project uses **TanStack Start** (React-based meta-framework) with:
- File-based routing in `apps/web/app/routes/`
- Server-side rendering (SSR) by default
- Type-safe routing with TanStack Router

## UI Components - shadcn/ui

We use **shadcn/ui** for UI components. These are not installed as dependencies but copied directly into the codebase for full customization.

### Adding Components

```bash
# From project root
cd apps/web
npx shadcn@latest add <component-name>
```

Components are added to `apps/web/app/components/ui/` and can be freely modified.

### Key Principles

- **Customize freely** - shadcn components are meant to be edited to fit project needs
- **Composition over configuration** - Build complex UIs by composing primitive components
- **Accessibility first** - All shadcn components are built with Radix UI primitives

## Styling

- **Tailwind CSS** for styling
- Dark mode support via `next-themes` (or similar)
- Component variants using `class-variance-authority` (cva)

## State Management

- **React Server Components** for server state by default
- **TanStack Query** for client-side async state (if needed)
- Local component state with `useState`/`useReducer` for UI state

## Component Structure

Prefer functional components with clear separation:

```tsx
// Good: Clear, composable, typed
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
- Prefer server components by default, opt into client components when needed (`"use client"`)
- Keep components small and focused
- Colocate related components in feature directories when appropriate
