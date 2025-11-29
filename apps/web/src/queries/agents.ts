import { rpc } from "@/lib/rpc";

export type AgentSession = {
  id: string;
  cellId: string;
  templateId: string;
  provider: string;
  status: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AgentMessagePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
};

export type AgentMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  state: string;
  createdAt: string;
  parts: AgentMessagePart[];
};

export const agentQueries = {
  sessionByCell: (cellId: string) => ({
    queryKey: ["agent-session", cellId] as const,
    queryFn: async (): Promise<AgentSession | null> => {
      const { data, error } = await rpc.api.agents.sessions
        .byCell({
          cellId,
        })
        .get();

      if (error) {
        throw new Error("Failed to load agent session");
      }

      return data.session as AgentSession | null;
    },
  }),
  messages: (sessionId: string | null) => ({
    queryKey: ["agent-messages", sessionId] as const,
    enabled: Boolean(sessionId),
    queryFn: async (): Promise<AgentMessage[]> => {
      if (!sessionId) {
        return [];
      }

      const { data, error } = await rpc.api.agents
        .sessions({ id: sessionId })
        .messages.get();

      if (error) {
        throw new Error("Failed to load agent messages");
      }

      return data.messages as AgentMessage[];
    },
  }),
};

export const agentMutations = {
  start: {
    mutationFn: async (input: {
      cellId: string;
      force?: boolean;
      modelId?: string;
    }) => {
      const { data, error } = await rpc.api.agents.sessions.post(input);
      if (error) {
        throw new Error("Failed to start agent session");
      }
      return data as AgentSession;
    },
  },
  sendMessage: {
    mutationFn: async (input: { sessionId: string; content: string }) => {
      const { error } = await rpc.api.agents
        .sessions({ id: input.sessionId })
        .messages.post({ content: input.content });
      if (error) {
        throw new Error("Failed to send agent message");
      }
      return true;
    },
  },
  respondPermission: {
    mutationFn: async (input: {
      sessionId: string;
      permissionId: string;
      response: "once" | "always" | "reject";
    }) => {
      const { error } = await rpc.api.agents
        .sessions({ id: input.sessionId })
        .permissions({ permissionId: input.permissionId })
        .post({ response: input.response });
      if (error) {
        throw new Error("Failed to update permission");
      }
      return true;
    },
  },
};
