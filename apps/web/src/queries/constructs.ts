import {
  type CreateConstructInput,
  rpc,
  type UpdateConstructInput,
} from "@/lib/rpc";

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

  update: {
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateConstructInput;
    }) => {
      const { data, error } = await rpc.api.constructs({ id }).put(body);
      if (error) {
        throw new Error("Failed to update construct");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Failed to update construct";
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
};

// Export inferred types for use in components
export type Construct = Awaited<
  ReturnType<ReturnType<typeof constructQueries.detail>["queryFn"]>
>;
