import { createOpencodeClient } from "@opencode-ai/sdk";
import { rpc } from "@/lib/rpc";

export const opencodeQueries = {
  status: (port?: number) => ({
    queryKey: ["opencode", "status", port] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api["opencode-test"].status.get({
        query: { port },
      });

      if (error) {
        throw new Error("Failed to fetch OpenCode status");
      }

      return data;
    },
  }),

  sessions: (baseUrl: string) => ({
    queryKey: ["opencode", "sessions", baseUrl] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });
      const { data, error } = await client.session.list();

      if (error) {
        throw new Error("Failed to fetch sessions");
      }

      return data;
    },
  }),
};

export const opencodeMutations = {
  init: {
    mutationFn: async (port?: number) => {
      const { data, error } = await rpc.api["opencode-test"].init.post({
        port,
      });

      if (error) {
        const message =
          "value" in error && "message" in error.value
            ? error.value.message
            : "Failed to initialize OpenCode";
        throw new Error(message);
      }

      return data;
    },
  },

  shutdown: {
    mutationFn: async (port?: number) => {
      const { data, error } = await rpc.api["opencode-test"].shutdown.delete({
        query: { port },
      });

      if (error) {
        const message =
          "value" in error && "message" in error.value
            ? error.value.message
            : "Failed to shutdown OpenCode";
        throw new Error(message);
      }

      return data;
    },
  },

  createSession: {
    mutationFn: async ({
      baseUrl,
      title,
    }: {
      baseUrl: string;
      title?: string;
    }) => {
      const client = createOpencodeClient({ baseUrl });
      const { data, error } = await client.session.create({
        body: { title },
      });

      if (error) {
        throw new Error("Failed to create session");
      }

      return data;
    },
  },
};
