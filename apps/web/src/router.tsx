import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import ErrorPage from "./components/error";
import Loader from "./components/loader";
import "./index.css";
import { routeTree } from "./routeTree.gen";

const ONE_MINUTE_IN_MS = 60_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: ONE_MINUTE_IN_MS,
    },
  },
});

export const getRouter = () => {
  const router = createTanStackRouter({
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
