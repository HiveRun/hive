import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type {
  AgentMessage,
  AgentOrchestrator,
  AgentSession,
  AgentSessionConfig,
  AgentStatus,
} from "./types";

/**
 * OpenCode agent session implementation
 */
class OpenCodeAgentSession implements AgentSession {
  public id: string;
  public constructId: string;
  public provider: AgentOrchestrator["createSession"] extends (
    // biome-ignore lint/suspicious/noExplicitAny: type inference for provider from interface
    ...args: any[]
  ) => Promise<infer T>
    ? T extends AgentSession
      ? T["provider"]
      : never
    : never;
  public status: AgentStatus = "starting";
  public createdAt: Date;
  public updatedAt: Date;

  private readonly client: OpencodeClient;
  private readonly statusCallbacks: Array<(status: AgentStatus) => void> = [];
  private readonly messageCallbacks: Array<(message: AgentMessage) => void> =
    [];
  private readonly opencodeSessionId?: string;
  private readonly messageBuffer: AgentMessage[] = [];

  constructor(
    client: OpencodeClient,
    config: AgentSessionConfig,
    opencodeSessionId: string
  ) {
    this.id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.constructId = config.constructId;
    this.provider = config.provider;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.client = client;
    this.opencodeSessionId = opencodeSessionId;

    // Add initial system message
    const systemMessage: AgentMessage = {
      role: "system",
      content: config.prompt,
      timestamp: new Date(),
    };
    this.messageBuffer.push(systemMessage);
    this.notifyMessage(systemMessage);

    // Start monitoring session
    this.startSessionMonitoring();
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.opencodeSessionId) {
      throw new Error("OpenCode session not initialized");
    }

    this.setStatus("working");

    const userMessage: AgentMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    this.messageBuffer.push(userMessage);
    this.notifyMessage(userMessage);

    try {
      // Send message to OpenCode
      await this.client.session.prompt({
        path: { id: this.opencodeSessionId },
        body: { parts: [{ type: "text", text: content }] },
      });

      // For now, simulate getting a response
      // In real implementation, would use SSE or polling for responses
      setTimeout(() => {
        const assistantMessage: AgentMessage = {
          role: "assistant",
          content: `Processing: ${content}`,
          timestamp: new Date(),
        };
        this.messageBuffer.push(assistantMessage);
        this.notifyMessage(assistantMessage);
        this.setStatus("awaiting_input");
      }, 1000);
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  getMessages(): Promise<AgentMessage[]> {
    return Promise.resolve([...this.messageBuffer]);
  }

  async stop(): Promise<void> {
    if (!this.opencodeSessionId) {
      return;
    }

    try {
      await this.client.session.delete({
        path: { id: this.opencodeSessionId },
      });
      this.setStatus("completed");
    } catch (_error) {
      this.setStatus("error");
    }
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

  private notifyMessage(message: AgentMessage): void {
    for (const callback of this.messageCallbacks) {
      callback(message);
    }
  }

  private async startSessionMonitoring(): Promise<void> {
    if (!this.opencodeSessionId) {
      return;
    }

    try {
      // Get session status
      const session = await this.client.session.get({
        path: { id: this.opencodeSessionId },
      });

      // Map OpenCode status to our status
      const sessionStatus = (session.data as { status?: string })?.status;
      switch (sessionStatus) {
        case "running":
          this.setStatus("working");
          break;
        case "waiting":
          this.setStatus("awaiting_input");
          break;
        case "completed":
          this.setStatus("completed");
          break;
        case "error":
          this.setStatus("error");
          break;
        default:
          this.setStatus("starting");
      }

      // Get existing messages
      const messages = await this.client.session.messages({
        path: { id: this.opencodeSessionId },
      });

      for (const msg of messages.data || []) {
        const agentMessage: AgentMessage = {
          role: "assistant",
          content: msg.parts?.[0]?.type === "text" ? msg.parts[0].text : "",
          timestamp: new Date(),
        };
        this.messageBuffer.push(agentMessage);
        this.notifyMessage(agentMessage);
      }
    } catch (_error) {
      this.setStatus("error");
    }
  }
}

/**
 * OpenCode agent orchestrator implementation
 */
export class OpenCodeAgentOrchestrator implements AgentOrchestrator {
  private readonly sessions = new Map<string, OpenCodeAgentSession>();
  private client?: OpencodeClient;

  private readonly opencodeUrl?: string;

  constructor(opencodeUrl?: string) {
    this.opencodeUrl = opencodeUrl;
    // Initialize client when needed
  }

  getClient(): Promise<OpencodeClient> {
    if (!this.client) {
      this.client = createOpencodeClient({
        baseUrl: this.opencodeUrl || "http://localhost:4096",
      });
    }
    return Promise.resolve(this.client);
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const client = await this.getClient();

    try {
      // Create OpenCode session
      const response = await client.session.create({
        body: {
          title: config.prompt,
        },
      });

      const opencodeSessionId = response.data?.id || "";
      const session = new OpenCodeAgentSession(
        client,
        config,
        opencodeSessionId
      );

      this.sessions.set(session.id, session);
      return session;
    } catch (error) {
      throw new Error(`Failed to create OpenCode session: ${error}`);
    }
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
