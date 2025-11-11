import { type CreateConstructInput, rpc } from "@/lib/rpc";

export const constructQueries = {
  all: () => ({
    queryKey: ["constructs"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs.get();
      if (error) {
        throw new Error("Failed to fetch constructs");
      }
      return data.constructs;
    },
  }),

  detail: (id: string) => ({
    queryKey: ["constructs", id] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs({ id }).get();
      if (error) {
        throw new Error("Construct not found");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Construct not found";
        throw new Error(message);
      }

      return data;
    },
  }),

  services: (id: string) => ({
    queryKey: ["constructs", id, "services"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs({ id }).services.get();
      if (error) {
        throw new Error("Failed to load services");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Construct not found";
        throw new Error(message);
      }

      return data.services;
    },
  }),
};

type ServiceActionInput = {
  constructId: string;
  serviceId: string;
  serviceName: string;
};

export const constructMutations = {
  create: {
    mutationFn: async (input: CreateConstructInput) => {
      const { data, error } = await rpc.api.constructs.post(input);
      if (error) {
        throw new Error("Failed to create construct");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Failed to create construct";
        throw new Error(message);
      }

      return data;
    },
  },

  delete: {
    mutationFn: async (id: string) => {
      const { data, error } = await rpc.api.constructs({ id }).delete();
      if (error) {
        throw new Error("Failed to delete construct");
      }
      return data;
    },
  },

  deleteMany: {
    mutationFn: async (ids: string[]) => {
      const { data, error } = await rpc.api.constructs.delete({ ids });
      if (error) {
        throw new Error("Failed to delete constructs");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Failed to delete constructs";
        throw new Error(message);
      }

      return data;
    },
  },

  startService: {
    mutationFn: async ({ constructId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .services({ serviceId })
        .start.post();
      if (error) {
        throw new Error("Failed to start service");
      }
      return data;
    },
  },

  stopService: {
    mutationFn: async ({ constructId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .services({ serviceId })
        .stop.post();
      if (error) {
        throw new Error("Failed to stop service");
      }
      return data;
    },
  },
};

// Export inferred types for use in components
export type Construct = Awaited<
  ReturnType<ReturnType<typeof constructQueries.detail>["queryFn"]>
>;

export type ConstructServiceSummary = Awaited<
  ReturnType<ReturnType<typeof constructQueries.services>["queryFn"]>
>[number];
