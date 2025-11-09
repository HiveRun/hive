import type { OpencodeClient } from "@opencode-ai/sdk";
import { createOpencode } from "@opencode-ai/sdk";
import { Elysia, t } from "elysia";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

const DEFAULT_PORT = 5006;
const DEFAULT_HOSTNAME = "127.0.0.1";

type OpencodeInstance = {
  server: {
    url: string;
    close: () => void;
  };
  client: OpencodeClient;
};

const activeInstances = new Map<number, OpencodeInstance>();

export const opencodeTestRoutes = new Elysia({ prefix: "/api/opencode-test" })
  .post(
    "/init",
    async ({ body, set }) => {
      const port = body.port || DEFAULT_PORT;

      try {
        const existingInstance = activeInstances.get(port);

        if (existingInstance) {
          return {
            reused: true,
            serverUrl: existingInstance.server.url,
            message: "Reusing existing OpenCode server",
          };
        }

        const newInstance = await createOpencode({
          hostname: DEFAULT_HOSTNAME,
          port,
          config: {
            model: "zen/big-pickle",
          },
        });

        activeInstances.set(port, newInstance);

        return {
          reused: false,
          serverUrl: newInstance.server.url,
          message: "OpenCode server created successfully",
        };
      } catch (error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;

        const errorPort = body.port || DEFAULT_PORT;
        const instanceToCleanup = activeInstances.get(errorPort);
        if (instanceToCleanup) {
          try {
            instanceToCleanup.server.close();
          } catch {
            // Ignore cleanup errors
          }
          activeInstances.delete(errorPort);
        }

        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to initialize OpenCode",
        };
      }
    },
    {
      body: t.Object({
        port: t.Optional(t.Number()),
      }),
      response: {
        200: t.Object({
          reused: t.Boolean(),
          serverUrl: t.String(),
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .delete(
    "/shutdown",
    ({ query, set }) => {
      const port = query.port || DEFAULT_PORT;

      const instance = activeInstances.get(port);
      if (!instance) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: `No active OpenCode server on port ${port}`,
        };
      }

      try {
        instance.server.close();
        activeInstances.delete(port);

        return {
          message: `OpenCode server on port ${port} shut down successfully`,
        };
      } catch (error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to shutdown OpenCode server",
        };
      }
    },
    {
      query: t.Object({
        port: t.Optional(t.Number()),
      }),
      response: {
        200: t.Object({
          message: t.String(),
        }),
        400: t.Object({
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .get(
    "/status",
    ({ query, set }) => {
      const port = query.port || DEFAULT_PORT;

      const instance = activeInstances.get(port);
      if (!instance) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          active: false,
          message: `No active OpenCode server on port ${port}`,
        };
      }

      return {
        active: true,
        serverUrl: instance.server.url,
        message: "OpenCode server is running",
      };
    },
    {
      query: t.Object({
        port: t.Optional(t.Number()),
      }),
      response: {
        200: t.Object({
          active: t.Boolean(),
          serverUrl: t.Optional(t.String()),
          message: t.String(),
        }),
        400: t.Object({
          active: t.Boolean(),
          message: t.String(),
        }),
      },
    }
  );
