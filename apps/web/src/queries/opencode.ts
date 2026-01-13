import { createOpencodeClient } from "@opencode-ai/sdk";
import { rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export const opencodeQueries = {
  sessions: (baseUrl: string) => ({
    queryKey: ["opencode", "sessions", baseUrl] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });
      const { data, error } = await client.session.list();

      if (error) {
        throw new Error("Failed to fetch sessions");
      }

      return (data ?? []).filter((session) => !session.parentID);
    },
  }),

  sessionMessages: (
    baseUrl: string,
    sessionId: string,
    directory?: string
  ) => ({
    queryKey: ["opencode", "messages", baseUrl, sessionId, directory] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });

      const fetchMessages = async (dir?: string) => {
        const query: { limit: number; directory?: string } = { limit: 100 };
        if (dir) {
          query.directory = dir;
        }

        const { data, error } = await client.session.messages({
          path: { id: sessionId },
          query,
        });

        if (error) {
          throw new Error("Failed to fetch session messages");
        }

        return data;
      };

      const primary = await fetchMessages(directory);
      if (directory && primary.length === 0) {
        return fetchMessages();
      }

      return primary;
    },
  }),

  sessionDetail: (baseUrl: string, sessionId: string) => ({
    queryKey: ["opencode", "session", baseUrl, sessionId] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });
      const { data, error } = await client.session.get({
        path: { id: sessionId },
      });

      if (error) {
        throw new Error("Failed to fetch session details");
      }

      return data;
    },
  }),

  config: (baseUrl: string, directory?: string) => ({
    queryKey: ["opencode", "config", baseUrl, directory] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });
      const query = directory ? { directory } : undefined;

      const { data, error } = await client.config.get({
        query,
      });

      if (error) {
        throw new Error("Failed to fetch OpenCode config");
      }

      return data;
    },
  }),

  providers: (baseUrl: string) => ({
    queryKey: ["opencode", "providers", baseUrl] as const,
    queryFn: async () => {
      const client = createOpencodeClient({ baseUrl });
      const { data, error } = await client.config.providers();

      if (error) {
        throw new Error("Failed to fetch OpenCode providers");
      }

      return data;
    },
  }),
};

export const opencodeMutations = {
  createSession: {
    mutationFn: async (input: {
      cellId: string;
      force?: boolean;
      modelId?: string;
      providerId?: string;
    }) => {
      const { data, error } = await rpc.api.agents.sessions.post(input);
      if (error) {
        throw new Error(formatRpcError(error, "Failed to create session"));
      }

      if ("message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to create session")
        );
      }

      return data;
    },
  },

  createSessionWithMessage: {
    mutationFn: async (input: {
      cellId: string;
      message: string;
      force?: boolean;
      modelId?: string;
      providerId?: string;
    }) => {
      const { data, error } = await rpc.api.agents.sessions.post({
        cellId: input.cellId,
        force: input.force,
        modelId: input.modelId,
        providerId: input.providerId,
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to create session"));
      }

      if ("message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to create session")
        );
      }

      const { error: messageError } = await rpc.api.agents
        .sessions({ id: data.id })
        .messages.post({ content: input.message });
      if (messageError) {
        throw new Error(formatRpcError(messageError, "Failed to send message"));
      }

      return {
        sessionId: data.id,
      };
    },
  },

  sendMessage: {
    mutationFn: async (input: { sessionId: string; text: string }) => {
      const { error } = await rpc.api.agents
        .sessions({ id: input.sessionId })
        .messages.post({ content: input.text });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to send message"));
      }
      return true;
    },
  },
};
