import type {
  AgentMessage,
  AgentOrchestrator,
  AgentSession,
  AgentSessionConfig,
  AgentStatus,
} from "./types";

/**
 * Mock agent session for testing and development
 */
class MockAgentSession implements AgentSession {
  id: string;
  constructId: string;
  provider: AgentOrchestrator["createSession"] extends (
    // biome-ignore lint/suspicious/noExplicitAny: type inference for provider from interface
    ...args: any[]
  ) => Promise<infer T>
    ? T extends AgentSession
      ? T["provider"]
      : never
    : never;
  status: AgentStatus = "starting";
  createdAt: Date;
  updatedAt: Date;

  private readonly messages: AgentMessage[] = [];
  private readonly statusCallbacks: Array<(status: AgentStatus) => void> = [];
  private readonly messageCallbacks: Array<(message: AgentMessage) => void> =
    [];

  constructor(config: AgentSessionConfig) {
    this.id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.constructId = config.constructId;
    this.provider = config.provider;
    this.createdAt = new Date();
    this.updatedAt = new Date();

    // Add initial system message
    this.messages.push({
      role: "system",
      content: config.prompt,
      timestamp: new Date(),
    });

    // Simulate agent starting
    setTimeout(() => {
      this.setStatus("working");
      this.addMessage({
        role: "assistant",
        content: "Hello! I'm ready to help with your task.",
        timestamp: new Date(),
      });
    }, 100);
  }

  sendMessage(content: string): Promise<void> {
    const userMessage: AgentMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    };

    this.addMessage(userMessage);
    this.setStatus("working");

    // Simulate agent response
    setTimeout(() => {
      const response: AgentMessage = {
        role: "assistant",
        content: `Received: ${content}`,
        timestamp: new Date(),
      };
      this.addMessage(response);
      this.setStatus("awaiting_input");
    }, 500);

    // Return resolved promise to match interface
    return Promise.resolve();
  }

  getMessages(): Promise<AgentMessage[]> {
    return Promise.resolve([...this.messages]);
  }

  stop(): Promise<void> {
    this.setStatus("completed");
    return Promise.resolve();
  }

  onStatusChange(callback: (status: AgentStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      const index = this.statusCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusCallbacks.splice(index, 1);
      }
    };
  }

  onMessage(callback: (message: AgentMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index > -1) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.updatedAt = new Date();
    for (const callback of this.statusCallbacks) {
      callback(status);
    }
  }

  private addMessage(message: AgentMessage): void {
    this.messages.push(message);
    for (const callback of this.messageCallbacks) {
      callback(message);
    }
  }
}

/**
 * Mock agent orchestrator for testing and development
 */
export class MockAgentOrchestrator implements AgentOrchestrator {
  private readonly sessions = new Map<string, MockAgentSession>();

  createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new MockAgentSession(config);
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  getSession(sessionId: string): Promise<AgentSession | null> {
    return Promise.resolve(this.sessions.get(sessionId) || null);
  }

  listSessions(constructId: string): Promise<AgentSession[]> {
    return Promise.resolve(
      Array.from(this.sessions.values()).filter(
        (s) => s.constructId === constructId
      )
    );
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.stop();
      this.sessions.delete(sessionId);
    }
  }
}
