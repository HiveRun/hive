import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { MainLayout } from "@/components/main-layout";
import { Toaster } from "@/components/ui/sonner";

export type RouterAppContext = {
  queryClient: QueryClient;
};

const DEVTOOLS_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEVTOOLS !== "false";

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
});

function RootComponent() {
  const isFetching = useRouterState({ select: (s) => s.isLoading });
  return (
    <>
      <MainLayout isLoading={isFetching}>
        <Outlet />
      </MainLayout>
      <Toaster richColors />
      {DEVTOOLS_ENABLED ? (
        <>
          <ReactQueryDevtools buttonPosition="bottom-right" />
          <TanStackRouterDevtools position="bottom-left" />
        </>
      ) : null}
    </>
  );
}
