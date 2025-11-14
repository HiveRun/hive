import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useGlobalAgentMonitor } from "@/hooks/use-global-agent-monitor";

export function GlobalAgentMonitor() {
  const router = useRouter();

  const handleNavigate = useCallback(
    (constructId: string) => {
      router.navigate({
        to: "/constructs/$constructId/chat",
        params: { constructId },
      });
    },
    [router]
  );

  useGlobalAgentMonitor({ onNavigateToConstruct: handleNavigate });

  return null;
}
