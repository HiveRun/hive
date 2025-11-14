import { useGlobalAgentMonitor } from "@/hooks/use-global-agent-monitor";

export function GlobalAgentMonitor() {
  useGlobalAgentMonitor();

  // This component doesn't render anything
  return null;
}
