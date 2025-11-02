export * from "./mock-orchestrator";
export * from "./types";

import { MockAgentOrchestrator } from "./mock-orchestrator";
import type { AgentOrchestrator } from "./types";

/**
 * Create an agent orchestrator instance.
 *
 * For now, this returns a mock orchestrator for development.
 * In production, this will integrate with the OpenCode SDK.
 */
export function createAgentOrchestrator(): AgentOrchestrator {
  // TODO: Integrate with @opencode-ai/sdk when available
  return new MockAgentOrchestrator();
}
