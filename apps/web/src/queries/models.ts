import { rpc } from "@/lib/rpc";

type ModelListResult = Awaited<ReturnType<typeof rpc.api.agents.models.get>>;

export type ModelListResponse = NonNullable<ModelListResult["data"]>;
export type AvailableModel = ModelListResponse["models"][number];

const modelListFromResponse = ({ data, error }: ModelListResult) => {
  if (error) {
    throw new Error("Failed to fetch models");
  }
  return data;
};

export const modelQueries = {
  bySession: (sessionId: string) => ({
    queryKey: ["models", sessionId] as const,
    queryFn: async () =>
      modelListFromResponse(
        await rpc.api.agents.sessions({ id: sessionId }).models.get()
      ),
  }),
  byWorkspace: (workspaceId: string) => ({
    queryKey: ["models", "workspace", workspaceId] as const,
    queryFn: async () =>
      modelListFromResponse(
        await rpc.api.agents.models.get({ query: { workspaceId } })
      ),
  }),
};
