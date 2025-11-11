import type { AgentStreamEvent } from "./types";

const subscribers = new Map<string, Set<(event: AgentStreamEvent) => void>>();

export function publishAgentEvent(
  sessionId: string,
  event: AgentStreamEvent
): void {
  const sessionSubscribers = subscribers.get(sessionId);
  if (!sessionSubscribers?.size) {
    return;
  }

  for (const handler of sessionSubscribers) {
    try {
      handler(event);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: fallback logging until structured logger is wired up.
      console.error("Failed to publish agent event", error);
    }
  }
}

export function subscribeAgentEvents(
  sessionId: string,
  handler: (event: AgentStreamEvent) => void
): () => void {
  const sessionSubscribers =
    subscribers.get(sessionId) ?? new Set<(event: AgentStreamEvent) => void>();
  sessionSubscribers.add(handler);
  subscribers.set(sessionId, sessionSubscribers);

  return () => {
    const current = subscribers.get(sessionId);
    if (!current) {
      return;
    }
    current.delete(handler);
    if (current.size === 0) {
      subscribers.delete(sessionId);
    }
  };
}
