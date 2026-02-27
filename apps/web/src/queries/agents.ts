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
  modelId?: string;
  modelProviderId?: string;
  startMode?: "plan" | "build";
  currentMode?: "plan" | "build";
  modeUpdatedAt?: string;
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
};
