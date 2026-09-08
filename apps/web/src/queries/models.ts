import type { UseQueryOptions } from "@tanstack/react-query";
import { rpc } from "@/lib/rpc";

type ModelListResult = NonNullable<
  Awaited<ReturnType<typeof rpc.api.agents.models.get>>["data"]
>;

export type ModelListResponse = ModelListResult;
export type AvailableModel = ModelListResponse["models"][number];

type ModelsQueryOptions = UseQueryOptions<
  ModelListResponse,
  Error,
  ModelListResponse
>;

const emptyModelList = (): ModelListResponse => ({
  models: [],
  defaults: {},
  stickyVariants: {},
  providers: [],
});

export const modelQueries = {
  bySession: (sessionId: string): ModelsQueryOptions => ({
    queryKey: ["models", sessionId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.agents
        .sessions({ id: sessionId })
        .models.get();
      if (error) {
        throw new Error("Failed to fetch models");
      }
      return data ?? emptyModelList();
    },
  }),
  byWorkspace: (workspaceId: string): ModelsQueryOptions => ({
    queryKey: ["models", "workspace", workspaceId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.agents.models.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error("Failed to fetch models");
      }
      return data ?? emptyModelList();
    },
  }),
};
