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

const rawDevtoolsFlag =
  (import.meta.env as Record<string, string | undefined>)
    .VITE_ENABLE_DEVTOOLS ??
  (import.meta.env as Record<string, string | undefined>)
    .REACT_APP_SHOW_DEV_TOOLS;

const DEVTOOLS_ENABLED =
  typeof rawDevtoolsFlag === "string"
    ? rawDevtoolsFlag !== "false" && rawDevtoolsFlag !== "0"
    : import.meta.env.DEV;

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
