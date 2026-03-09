import { QueryClient } from "@tanstack/react-query";

const STORYBOOK_CACHE_TIME_MS = Number.POSITIVE_INFINITY;

export function createStorybookQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STORYBOOK_CACHE_TIME_MS,
        gcTime: STORYBOOK_CACHE_TIME_MS,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
