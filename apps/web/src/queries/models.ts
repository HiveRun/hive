import type { UseQueryOptions } from "@tanstack/react-query";
import { fetchControllerJson } from "@/lib/controller-query";
import {
  agentModelsPath,
  agentSessionModelsPath,
} from "@/lib/generated/controller-routes";

export type AvailableModel = {
  id: string;
  name: string;
  provider: string;
};

export type ProviderInfo = {
  id: string;
  name?: string;
};

export type ModelListResponse = {
  models: AvailableModel[];
  defaults: Record<string, string>;
  providers: ProviderInfo[];
};

type ModelsQueryOptions = UseQueryOptions<
  ModelListResponse,
  Error,
  ModelListResponse
>;

export const modelQueries = {
  bySession: (sessionId: string): ModelsQueryOptions => ({
    queryKey: ["models", sessionId] as const,
    queryFn: async (): Promise<ModelListResponse> => {
      const data = await fetchControllerJson<ModelListResponse>(
        agentSessionModelsPath({ id: sessionId }),
        "Failed to fetch models"
      );
      const response = data as ModelListResponse | undefined;
      return (
        response ?? {
          models: [],
          defaults: {},
          providers: [],
        }
      );
    },
  }),
  byWorkspace: (workspaceId: string): ModelsQueryOptions => ({
    queryKey: ["models", "workspace", workspaceId] as const,
    queryFn: async (): Promise<ModelListResponse> => {
      const data = await fetchControllerJson<ModelListResponse>(
        agentModelsPath({ workspaceId }),
        "Failed to fetch models"
      );
      const response = data as ModelListResponse | undefined;
      return (
        response ?? {
          models: [],
          defaults: {},
          providers: [],
        }
      );
    },
  }),
};
