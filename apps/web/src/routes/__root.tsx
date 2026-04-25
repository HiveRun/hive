import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DesktopStartupScreen } from "@/components/desktop-startup-screen";
import ErrorPage from "@/components/error";
import Loader from "@/components/loader";
import { MainLayout } from "@/components/main-layout";
import { Toaster } from "@/components/ui/sonner";
import { useDesktopStartup } from "@/hooks/use-desktop-startup";
import {
  ensureDesktopBackendReady,
  isDesktopRuntime,
  isDesktopStartupFailure,
  markDesktopStartupReady,
  resetDesktopStartup,
  setDesktopStartupError,
  setDesktopStartupLoadingWorkspaces,
} from "@/lib/desktop-startup";
import { workspaceQueries } from "@/queries/workspaces";

const WORKSPACE_STARTUP_RETRY_COUNT = 8;
const WORKSPACE_STARTUP_RETRY_DELAY_MS = 500;

const prepareDesktopStartup = async (queryClient: QueryClient) => {
  await ensureDesktopBackendReady();
  setDesktopStartupLoadingWorkspaces();
  await queryClient.ensureQueryData({
    ...workspaceQueries.list(),
    retry: WORKSPACE_STARTUP_RETRY_COUNT,
    retryDelay: WORKSPACE_STARTUP_RETRY_DELAY_MS,
  });
  markDesktopStartupReady();
};

export type RouterAppContext = {
  queryClient: QueryClient;
};

const disableDevtoolsFlag = (
  import.meta.env as Record<string, string | undefined>
).VITE_DISABLE_DEVTOOLS;

const DEVTOOLS_ENABLED =
  import.meta.env.DEV &&
  !(typeof disableDevtoolsFlag === "string"
    ? disableDevtoolsFlag === "true" || disableDevtoolsFlag === "1"
    : false);

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  pendingComponent: RootPendingComponent,
  errorComponent: RootErrorComponent,
});

function RootComponent() {
  return (
    <>
      <DesktopStartupGate>
        <MainLayout>
          <Outlet />
        </MainLayout>
      </DesktopStartupGate>
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

function useDesktopStartupController() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const snapshot = useDesktopStartup();
  const [retryToken, setRetryToken] = useState(0);
  const retryTokenRef = useRef(retryToken);
  const [isReady, setIsReady] = useState(
    () => !isDesktopRuntime() || snapshot.phase === "ready"
  );

  useEffect(() => {
    if (!isDesktopRuntime() || isReady) {
      return;
    }

    let cancelled = false;
    const runToken = retryToken;
    retryTokenRef.current = runToken;
    const shouldIgnoreStartupResult = () =>
      cancelled || retryTokenRef.current !== runToken;

    const runStartup = async () => {
      try {
        await prepareDesktopStartup(queryClient);

        if (shouldIgnoreStartupResult()) {
          return;
        }

        setIsReady(true);
        await router.invalidate();
      } catch (error) {
        if (shouldIgnoreStartupResult()) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Desktop startup failed: Hive did not become ready.";
        setDesktopStartupError(message);
      }
    };

    runStartup();

    return () => {
      cancelled = true;
    };
  }, [isReady, queryClient, retryToken, router]);

  return {
    isReady: isReady || !isDesktopRuntime(),
    retry: () => {
      resetDesktopStartup();
      setIsReady(false);
      setRetryToken((value) => value + 1);
    },
    snapshot,
  };
}

function DesktopStartupGate({ children }: { children: ReactNode }) {
  const startup = useDesktopStartupController();

  if (startup.isReady) {
    return children;
  }

  return (
    <DesktopStartupScreen
      onRetry={startup.snapshot.phase === "error" ? startup.retry : undefined}
      snapshot={startup.snapshot}
    />
  );
}

function RootPendingComponent() {
  const startup = useDesktopStartupController();

  if (!startup.isReady) {
    return <DesktopStartupScreen snapshot={startup.snapshot} />;
  }

  return <Loader />;
}

function RootErrorComponent({
  error,
  reset,
}: {
  error: Error;
  reset?: () => void;
}) {
  const startup = useDesktopStartupController();

  if (!startup.isReady) {
    return (
      <DesktopStartupScreen
        onRetry={() => {
          startup.retry();
          reset?.();
        }}
        snapshot={startup.snapshot}
      />
    );
  }

  if (isDesktopStartupFailure(error)) {
    return (
      <DesktopStartupScreen
        onRetry={() => {
          resetDesktopStartup();
          reset?.();
        }}
        snapshot={startup.snapshot}
      />
    );
  }

  return <ErrorPage error={error} reset={reset} />;
}
