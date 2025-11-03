import { rpc } from "@/lib/rpc";
import { unwrapRpcResponse } from "@/lib/utils";
import type {
  Construct,
  ConstructStatus,
  ConstructType,
} from "@/types/construct";

export type ConstructListParams = {
  status?: ConstructStatus;
  type?: ConstructType;
  limit?: number;
  offset?: number;
};

export const constructQueries = {
  all: (params?: ConstructListParams) => ({
    queryKey: ["constructs", params] as const,
    queryFn: async (): Promise<Construct[]> => {
      const queryParams = new URLSearchParams();
      if (params?.status) {
        queryParams.set("status", params.status);
      }
      if (params?.type) {
        queryParams.set("type", params.type);
      }
      if (typeof params?.limit === "number") {
        queryParams.set("limit", params.limit.toString());
      }
      if (typeof params?.offset === "number") {
        queryParams.set("offset", params.offset.toString());
      }

      const response = await rpc.api.constructs.get({
        query: Object.fromEntries(queryParams),
      });

      return unwrapRpcResponse<Construct[]>(
        response,
        "Failed to fetch constructs"
      );
    },
  }),

  detail: (id: string) => ({
    queryKey: ["constructs", id] as const,
    queryFn: async (): Promise<Construct> => {
      const response = await rpc.api.constructs({ id }).get();
      return unwrapRpcResponse<Construct>(
        response,
        "Failed to fetch construct"
      );
    },
  }),
};

export const constructMutations = {
  create: {
    mutationFn: async (input: {
      name: string;
      description?: string;
      templateId: string;
    }) => {
      const response = await rpc.api.constructs.post(input);
      return unwrapRpcResponse(response, "Failed to create construct");
    },
  },

  update: {
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      name?: string;
      description?: string;
      status?: ConstructStatus;
    }) => {
      const response = await rpc.api.constructs({ id }).patch(input);
      return unwrapRpcResponse<Construct>(
        response,
        "Failed to update construct"
      );
    },
  },

  delete: {
    mutationFn: async (id: string) => {
      const response = await rpc.api.constructs({ id }).delete();
      return unwrapRpcResponse(response, "Failed to delete construct");
    },
  },

  startAgent: {
    mutationFn: async ({
      id,
      provider,
    }: {
      id: string;
      provider?: "anthropic" | "openai";
    }) => {
      const response = await rpc.api
        .constructs({ id })
        .agent.start.post({ provider });
      return unwrapRpcResponse(response, "Failed to start agent");
    },
  },
};
