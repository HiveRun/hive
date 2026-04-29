import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ErrorPage from "@/components/error";
import Loader from "@/components/loader";
import { MainLayout } from "@/components/main-layout";
import { Toaster } from "@/components/ui/sonner";
import {
  ensureDesktopBackendReady,
  getDesktopStartupSnapshot,
  isDesktopRuntime,
  markDesktopStartupReady,
  resetDesktopStartup,
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
  const [retryToken, setRetryToken] = useState(0);
  const retryTokenRef = useRef(retryToken);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(
    () => !isDesktopRuntime() || getDesktopStartupSnapshot().phase === "ready"
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
        setError(null);
        await prepareDesktopStartup(queryClient);

        if (shouldIgnoreStartupResult()) {
          return;
        }

        setIsReady(true);
        await router.invalidate();
      } catch (startupError) {
        if (shouldIgnoreStartupResult()) {
          return;
        }

        setError(
          startupError instanceof Error
            ? startupError
            : new Error("Desktop startup failed: Hive did not become ready.")
        );
      }
    };

    runStartup();

    return () => {
      cancelled = true;
    };
  }, [isReady, queryClient, retryToken, router]);

  return {
    isReady: isReady || !isDesktopRuntime(),
    error,
    retry: () => {
      resetDesktopStartup();
      setError(null);
      setIsReady(false);
      setRetryToken((value) => value + 1);
    },
  };
}

function DesktopStartupGate({ children }: { children: ReactNode }) {
  const startup = useDesktopStartupController();

  if (startup.isReady) {
    return children;
  }

  if (startup.error) {
    return <ErrorPage error={startup.error} reset={startup.retry} />;
  }

  return <Loader />;
}

function RootPendingComponent() {
  const startup = useDesktopStartupController();

  if (!startup.isReady) {
    if (startup.error) {
      return <ErrorPage error={startup.error} reset={startup.retry} />;
    }

    return <Loader />;
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
    if (startup.error) {
      return (
        <ErrorPage
          error={startup.error}
          reset={() => {
            startup.retry();
            reset?.();
          }}
        />
      );
    }

    return <Loader />;
  }

  return <ErrorPage error={error} reset={reset} />;
}
