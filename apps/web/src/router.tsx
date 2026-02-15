import { QueryClient } from "@tanstack/react-query";
import {
  type Persister,
  PersistQueryClientProvider,
} from "@tanstack/react-query-persist-client";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import ErrorPage from "./components/error";
import { GlobalAgentMonitor } from "./components/global-agent-monitor";
import Loader from "./components/loader";
import { ThemeProvider } from "./components/theme-provider";
import { createIDBPersister } from "./lib/query-persister";
import "./index.css";
import { routeTree } from "./routeTree.gen";

const ONE_MINUTE_IN_MS = 60_000;
const ONE_DAY_IN_MS = 86_400_000;
const QUERY_CACHE_STORAGE_KEY = "hive.react-query-cache";
const QUERY_CACHE_BUSTER = "hive-web-cache-v1";

const shouldPersistQuery = (query: {
  state: { status: string };
  queryKey: readonly unknown[];
}) => {
  if (query.state.status !== "success") {
    return false;
  }

  const queryKey = query.queryKey;
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return false;
  }

  const [scope] = queryKey;
  if (scope === "workspaces") {
    return true;
  }

  if (scope === "templates" && queryKey.length === 2) {
    return true;
  }

  return (
    scope === "cells" &&
    queryKey.length === 2 &&
    typeof queryKey[1] === "string"
  );
};

const resolvePersistNoop: Persister["persistClient"] = () => Promise.resolve();
const resolveRestoreNoop: Persister["restoreClient"] = () =>
  Promise.resolve(undefined);
const resolveRemoveNoop: Persister["removeClient"] = () => Promise.resolve();

const noopPersister: Persister = {
  persistClient: resolvePersistNoop,
  restoreClient: resolveRestoreNoop,
  removeClient: resolveRemoveNoop,
};

const queryPersister: Persister =
  typeof window === "undefined"
    ? noopPersister
    : createIDBPersister(QUERY_CACHE_STORAGE_KEY);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: ONE_MINUTE_IN_MS,
      gcTime: ONE_DAY_IN_MS,
    },
  },
});

export const router = createTanStackRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
  context: {
    queryClient,
  },
  defaultPendingComponent: () => <Loader />,
  defaultErrorComponent: ({ error, reset }) => (
    <ErrorPage error={error} reset={reset} />
  ),
  defaultNotFoundComponent: () => <div>Not Found</div>,
  Wrap: ({ children }) => (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
        },
        maxAge: ONE_DAY_IN_MS,
        persister: queryPersister,
      }}
    >
      <ThemeProvider>
        <GlobalAgentMonitor />
        {children}
      </ThemeProvider>
    </PersistQueryClientProvider>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
