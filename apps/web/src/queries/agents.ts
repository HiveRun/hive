import { rpc } from "@/lib/rpc";

export const agentQueries = {
  sessionByCell: (cellId: string) => ({
    queryKey: ["agent-session", cellId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.agents.sessions
        .byCell({
          cellId,
        })
        .get();

      if (error) {
        throw new Error("Failed to load agent session");
      }

      return data.session;
    },
  }),
};

export type AgentSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof agentQueries.sessionByCell>["queryFn"]>>
>;
