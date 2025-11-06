import { rpc } from "@/lib/rpc";

export type Construct = {
  id: string;
  name: string;
  description: string | null;
  templateId: string;
  workspacePath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateConstructInput = {
  name: string;
  description?: string;
  templateId: string;
  branch?: string;
};

export type UpdateConstructInput = {
  name: string;
  description?: string;
  templateId: string;
};

export const constructQueries = {
  all: () => ({
    queryKey: ["constructs"] as const,
    queryFn: async (): Promise<Construct[]> => {
      const { data, error } = await rpc.api.constructs.get();
      if (error) {
        throw new Error("Failed to fetch constructs");
      }
      return data.constructs;
    },
  }),

  detail: (id: string) => ({
    queryKey: ["constructs", id] as const,
    queryFn: async (): Promise<Construct> => {
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
    mutationFn: async (input: CreateConstructInput): Promise<Construct> => {
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
      ...input
    }: UpdateConstructInput & { id: string }): Promise<Construct> => {
      const { data, error } = await rpc.api.constructs({ id }).put(input);
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
    mutationFn: async (id: string): Promise<{ message: string }> => {
      const { data, error } = await rpc.api.constructs({ id }).delete();
      if (error) {
        throw new Error("Failed to delete construct");
      }
      return data;
    },
  },
};
