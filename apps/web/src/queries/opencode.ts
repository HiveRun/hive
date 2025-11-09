import { createOpencodeClient } from "@opencode-ai/sdk";
import { rpc } from "@/lib/rpc";

type SessionPromptInput = Parameters<
  ReturnType<typeof createOpencodeClient>["session"]["prompt"]
>[0];

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

  createSessionWithMessage: {
    mutationFn: async ({
      baseUrl,
      title,
      message,
      directory,
      agent,
      model,
    }: {
      baseUrl: string;
      title?: string;
      message: string;
      directory?: string;
      agent?: string;
      model?: {
        providerID: string;
        modelID: string;
      };
    }) => {
      const client = createOpencodeClient({ baseUrl });

      // Step 1: Create session
      const sessionResult = await client.session.create({
        body: { title },
      });

      if (sessionResult.error) {
        throw new Error("Failed to create session");
      }

      const session = sessionResult.data;

      // Step 2: Send initial message to the session (fire-and-forget)
      const query: SessionPromptInput["query"] = directory
        ? { directory }
        : undefined;
      const body: NonNullable<SessionPromptInput["body"]> = {
        parts: [
          {
            type: "text",
            text: message,
          },
        ],
      };

      if (agent) {
        body.agent = agent;
      }

      if (model) {
        body.model = model;
      }

      // Don't await - fire and forget so UI can navigate immediately
      // The SSE stream will handle showing the response in real-time
      client.session.prompt({
        path: { id: session.id },
        query,
        body,
      });

      return {
        sessionId: session.id,
        title: session.title,
      };
    },
  },

  sendMessage: {
    mutationFn: async ({
      baseUrl,
      sessionId,
      text,
      directory,
      agent,
      model,
    }: {
      baseUrl: string;
      sessionId: string;
      text: string;
      directory?: string;
      agent?: string;
      model?: {
        providerID: string;
        modelID: string;
      };
    }) => {
      const client = createOpencodeClient({ baseUrl });
      const query: SessionPromptInput["query"] = directory
        ? { directory }
        : undefined;
      const body: NonNullable<SessionPromptInput["body"]> = {
        parts: [
          {
            type: "text",
            text,
          },
        ],
      };

      if (agent) {
        body.agent = agent;
      }

      if (model) {
        body.model = model;
      }

      // Force responseStyle to get the full response object so we can inspect errors
      const result = await client.session.prompt({
        path: { id: sessionId },
        query,
        body,
      });

      if (result.error) {
        throw new Error(
          `Failed to send message: ${JSON.stringify(result.error)}`
        );
      }

      if (!result.data) {
        throw new Error("No data returned from OpenCode server");
      }

      return result.data;
    },
  },
};
