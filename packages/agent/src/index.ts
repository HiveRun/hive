export * from "./mock-orchestrator";
export * from "./opencode-orchestrator";
export * from "./types";

import { MockAgentOrchestrator } from "./mock-orchestrator";
import { OpenCodeAgentOrchestrator } from "./opencode-orchestrator";
import type { AgentOrchestrator } from "./types";

/**
 * Create an agent orchestrator instance.
 *
 * Returns a real OpenCode orchestrator if available, otherwise falls back to mock.
 */
export function createAgentOrchestrator(options?: {
  opencodeUrl?: string;
  useMock?: boolean;
}): AgentOrchestrator {
  // Force mock mode if explicitly requested or in test environment
  if (options?.useMock || process.env.NODE_ENV === "test") {
    return new MockAgentOrchestrator();
  }

  try {
    // Try to use real OpenCode orchestrator
    return new OpenCodeAgentOrchestrator(options?.opencodeUrl);
  } catch (_error) {
    return new MockAgentOrchestrator();
  }
}
