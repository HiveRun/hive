import { Elysia, t } from "elysia";
import {
  closeInstance,
  createOpencodeServer,
  getInstance,
} from "../opencode/service";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

const DEFAULT_PORT = 5006;

// For test route compatibility, we track instances by port
const portToKey = new Map<number, string>();
const keyToPort = new Map<string, number>();

export const opencodeTestRoutes = new Elysia({ prefix: "/api/opencode-test" })
  .post(
    "/init",
    async ({ body, set }) => {
      const port = body.port || DEFAULT_PORT;
      const key = `test-port-${port}`;

      try {
        const existingKey = portToKey.get(port);
        if (existingKey) {
          const existingInstance = getInstance(existingKey);
          if (existingInstance) {
            return {
              reused: true,
              serverUrl: existingInstance.server.url,
              message: "Reusing existing OpenCode server",
            };
          }
        }

        const newInstance = await createOpencodeServer({
          model: "opencode/big-pickle",
        });

        portToKey.set(port, key);
        keyToPort.set(key, port);

        return {
          reused: false,
          serverUrl: newInstance.server.url,
          message: "OpenCode server created successfully",
        };
      } catch (error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;

        const cleanupKey = portToKey.get(port);
        if (cleanupKey) {
          closeInstance(cleanupKey);
          portToKey.delete(port);
          keyToPort.delete(cleanupKey);
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
      const key = portToKey.get(port);

      if (!key) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: `No active OpenCode server on port ${port}`,
        };
      }

      try {
        closeInstance(key);
        portToKey.delete(port);
        keyToPort.delete(key);

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
      const key = portToKey.get(port);

      if (!key) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          active: false,
          message: `No active OpenCode server on port ${port}`,
        };
      }

      const instance = getInstance(key);
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
