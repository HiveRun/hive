import { rpc } from "@/lib/rpc";

export type AgentSession = {
  id: string;
  constructId: string;
  templateId: string;
  provider: string;
  status: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AgentMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  state: string;
  createdAt: string;
  parts: unknown[];
};

export const agentQueries = {
  sessionByConstruct: (constructId: string) => ({
    queryKey: ["agent-session", constructId] as const,
    queryFn: async (): Promise<AgentSession | null> => {
      const { data, error } = await rpc.api.agents.sessions
        .byConstruct({
          constructId,
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
    refetchInterval: 2000,
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
      constructId: string;
      useMock?: boolean;
      force?: boolean;
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
      const { data, error } = await rpc.api.agents
        .sessions({ id: input.sessionId })
        .messages.post({ content: input.content });
      if (error) {
        throw new Error("Failed to send agent message");
      }
      return data as AgentMessage;
    },
  },
};
