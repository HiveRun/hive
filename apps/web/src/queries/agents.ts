import { rpc } from "@/lib/rpc";

type AgentSessionResponse = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof rpc.api.agents.sessions.byCell>["get"]>
  >["data"]
>;

export type AgentSession = Omit<
  NonNullable<AgentSessionResponse["session"]>,
  "provider"
> & {
  provider: string;
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
