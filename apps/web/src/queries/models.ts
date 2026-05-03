import type { UseQueryOptions } from "@tanstack/react-query";
import { rpc } from "@/lib/rpc";

type AvailableModelVariant = {
  id: string;
};

export type AvailableModel = {
  id: string;
  name: string;
  provider: string;
  variants: AvailableModelVariant[];
};

type ProviderInfo = {
  id: string;
  name?: string;
};

export type ModelListResponse = {
  models: AvailableModel[];
  defaults: Record<string, string>;
  stickyVariants: Record<string, string>;
  providers: ProviderInfo[];
};

type ModelsQueryOptions = UseQueryOptions<
  ModelListResponse,
  Error,
  ModelListResponse
>;

type ModelsRequest = () => Promise<{ data: unknown; error: unknown }>;

const emptyModelList = (): ModelListResponse => ({
  models: [],
  defaults: {},
  stickyVariants: {},
  providers: [],
});

const fetchModelList = async (request: ModelsRequest) => {
  const { data, error } = await request();
  if (error) {
    throw new Error("Failed to fetch models");
  }
  return (data as ModelListResponse | undefined) ?? emptyModelList();
};

export const modelQueries = {
  bySession: (sessionId: string): ModelsQueryOptions => ({
    queryKey: ["models", sessionId] as const,
    queryFn: () =>
      fetchModelList(() =>
        rpc.api.agents.sessions({ id: sessionId }).models.get()
      ),
  }),
  byWorkspace: (workspaceId: string): ModelsQueryOptions => ({
    queryKey: ["models", "workspace", workspaceId] as const,
    queryFn: () =>
      fetchModelList(() =>
        rpc.api.agents.models.get({
          query: { workspaceId },
        })
      ),
  }),
};
