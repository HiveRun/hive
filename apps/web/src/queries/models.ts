import type { UseQueryOptions } from "@tanstack/react-query";
import { rpc } from "@/lib/rpc";

export type AvailableModelVariant = {
  id: string;
};

export type AvailableModel = {
  id: string;
  name: string;
  provider: string;
  variants: AvailableModelVariant[];
};

export type ProviderInfo = {
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

export const modelQueries = {
  bySession: (sessionId: string): ModelsQueryOptions => ({
    queryKey: ["models", sessionId] as const,
    queryFn: async (): Promise<ModelListResponse> => {
      const { data, error } = await rpc.api.agents
        .sessions({ id: sessionId })
        .models.get();
      if (error) {
        throw new Error("Failed to fetch models");
      }
      const response = data as ModelListResponse | undefined;
      return (
        response ?? {
          models: [],
          defaults: {},
          stickyVariants: {},
          providers: [],
        }
      );
    },
  }),
  byWorkspace: (workspaceId: string): ModelsQueryOptions => ({
    queryKey: ["models", "workspace", workspaceId] as const,
    queryFn: async (): Promise<ModelListResponse> => {
      const { data, error } = await rpc.api.agents.models.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error("Failed to fetch models");
      }
      const response = data as ModelListResponse | undefined;
      return (
        response ?? {
          models: [],
          defaults: {},
          stickyVariants: {},
          providers: [],
        }
      );
    },
  }),
};
