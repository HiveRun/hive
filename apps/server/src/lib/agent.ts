import { MockAgentOrchestrator } from "./mock-orchestrator";
import { OpenCodeAgentOrchestrator } from "./opencode-orchestrator";
import type { AgentOrchestrator } from "./types";

export function createAgentOrchestrator(options?: {
  opencodeUrl?: string;
  useMock?: boolean;
}): AgentOrchestrator {
  if (options?.useMock || process.env.NODE_ENV === "test") {
    return new MockAgentOrchestrator();
  }

  try {
    return new OpenCodeAgentOrchestrator(options?.opencodeUrl);
  } catch (_error) {
    return new MockAgentOrchestrator();
  }
}
