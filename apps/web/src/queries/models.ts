import { rpc } from "@/lib/rpc";

export type AvailableModel = {
  id: string;
  name: string;
  provider: string;
};

export type ProviderInfo = {
  id: string;
  priority: number;
  category: string;
  description?: string;
  includeAllModels: boolean;
};

export type ModelListResponse = {
  models: AvailableModel[];
  defaults: Record<string, string>;
  providers: ProviderInfo[];
};

export const modelQueries = {
  bySession: (sessionId: string) => ({
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
          providers: [],
        }
      );
    },
  }),
};
