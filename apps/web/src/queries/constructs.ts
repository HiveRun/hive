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

const HTTP_STATUS_NOT_FOUND = 404;

export type CreateConstructInput = {
  name: string;
  description?: string;
  templateId: string;
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

// Worktree types
export type WorktreeInfo = {
  id: string;
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
};

export type CreateWorktreeInput = {
  branch?: string;
  force?: boolean;
};

export const worktreeQueries = {
  all: () => ({
    queryKey: ["worktrees"] as const,
    queryFn: async (): Promise<WorktreeInfo[]> => {
      const { data, error } = await rpc.api.worktrees.get();
      if (error) {
        throw new Error("Failed to fetch worktrees");
      }
      return data.worktrees;
    },
  }),

  forConstruct: (constructId: string) => ({
    queryKey: ["worktrees", constructId] as const,
    queryFn: async (): Promise<WorktreeInfo | null> => {
      const { data, error } = await rpc.api.worktrees({ constructId }).get();

      if (error) {
        const status = (error as { status?: number }).status;
        if (status === HTTP_STATUS_NOT_FOUND) {
          return null;
        }
        throw new Error("Failed to fetch worktree for construct");
      }

      if ("message" in data) {
        return null;
      }

      return data;
    },
  }),
};

export const worktreeMutations = {
  create: {
    mutationFn: async ({
      constructId,
      ...input
    }: CreateWorktreeInput & { constructId: string }): Promise<{
      message: string;
      path: string;
    }> => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .worktree.post(input);
      if (error) {
        throw new Error("Failed to create worktree");
      }

      if ("message" in data) {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Failed to create worktree";
        throw new Error(message);
      }

      return data;
    },
  },

  remove: {
    mutationFn: async (constructId: string): Promise<{ message: string }> => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .worktree.delete();
      if (error) {
        throw new Error("Failed to remove worktree");
      }
      return data;
    },
  },

  prune: {
    mutationFn: async (): Promise<{ message: string }> => {
      const { data, error } = await rpc.api.worktrees.prune.post();
      if (error) {
        throw new Error("Failed to prune worktrees");
      }
      return data;
    },
  },
};
