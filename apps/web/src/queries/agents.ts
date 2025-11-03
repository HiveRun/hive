import { rpc } from "@/lib/rpc";
import { unwrapRpcResponse } from "@/lib/utils";
import type { AgentMessage, AgentSession } from "@/types/agent";

export const agentQueries = {
  session: (constructId: string) => ({
    queryKey: ["agents", "session", constructId] as const,
    queryFn: async (): Promise<AgentSession> => {
      const response = await rpc.api.agents.construct({ constructId }).get();
      return unwrapRpcResponse<AgentSession>(
        response,
        "Failed to fetch agent session"
      );
    },
  }),

  messages: (sessionId: string) => ({
    queryKey: ["agents", "messages", sessionId] as const,
    queryFn: async (): Promise<AgentMessage[]> => {
      const response = await rpc.api.agents({ sessionId }).messages.get();
      return unwrapRpcResponse<AgentMessage[]>(
        response,
        "Failed to fetch messages"
      );
    },
  }),
};

export const agentMutations = {
  sendMessage: {
    mutationFn: async ({
      sessionId,
      content,
    }: {
      sessionId: string;
      content: string;
    }) => {
      const response = await rpc.api
        .agents({ sessionId })
        .messages.post({ content });
      return unwrapRpcResponse(response, "Failed to send message");
    },
  },

  stop: {
    mutationFn: async (sessionId: string) => {
      const response = await rpc.api.agents({ sessionId }).stop.post();
      return unwrapRpcResponse(response, "Failed to stop agent");
    },
  },
};
