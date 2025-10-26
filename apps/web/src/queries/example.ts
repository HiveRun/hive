/**
 * Example query factory pattern
 *
 * Query factories provide:
 * - Type-safe queryKey/queryFn pairing
 * - Reusable across components
 * - Easier cache invalidation
 * - Single source of truth for queries
 *
 * Usage in components:
 * ```tsx
 * const { data } = useQuery(exampleQueries.all())
 * ```
 *
 * Usage in route loaders:
 * ```tsx
 * loader: ({ context: { queryClient } }) =>
 *   queryClient.ensureQueryData(exampleQueries.all())
 * ```
 */

// Example: Replace with actual RPC client
// import { rpcClient } from '@/lib/rpc'

export const exampleQueries = {
  /**
   * Get all items
   */
  all: () => ({
    queryKey: ["example"] as const,
    queryFn: () => {
      // Replace with: rpcClient.example.list()
      return Promise.resolve([]);
    },
  }),

  /**
   * Get a single item by ID
   */
  detail: (id: string) => ({
    queryKey: ["example", id] as const,
    queryFn: () => {
      // Replace with: rpcClient.example.get(id)
      return Promise.resolve({ id });
    },
  }),

  /**
   * Search/filter items
   */
  search: (term: string) => ({
    queryKey: ["example", "search", term] as const,
    queryFn: () => {
      // Replace with: rpcClient.example.search(term)
      return Promise.resolve([]);
    },
  }),
};

/**
 * Example mutation pattern
 *
 * Usage:
 * ```tsx
 * const mutation = useMutation({
 *   ...exampleMutations.create,
 *   onSuccess: () => {
 *     queryClient.invalidateQueries({ queryKey: ['example'] })
 *   }
 * })
 * ```
 */
export const exampleMutations = {
  create: {
    mutationFn: (data: unknown) => {
      // Replace with: rpcClient.example.create(data)
      return Promise.resolve(data);
    },
  },

  update: {
    mutationFn: ({ id, data }: { id: string; data: unknown }) => {
      // Replace with: rpcClient.example.update(id, data)
      return Promise.resolve({ id, data });
    },
  },

  delete: {
    mutationFn: (id: string) => {
      // Replace with: rpcClient.example.delete(id)
      return Promise.resolve({ id });
    },
  },
};
