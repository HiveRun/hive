import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createDb, schema } from "../db";
import {
  constructIdParamSchema,
  serviceIdParamSchema,
} from "../lib/zod-schemas";
import {
  checkAllServices,
  getConstructServices,
  getServiceInfo,
  getServiceStatus,
  restartService,
  startService,
  stopService,
} from "../services/service-manager";

export const servicesRoutes = new Elysia({ prefix: "/api/services" })
  .get(
    "/construct/:constructId",
    async ({ params, set }) => {
      const db = createDb();
      try {
        const services = await getConstructServices(db, params.constructId);
        return { data: services };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: constructIdParamSchema,
    }
  )

  .get(
    "/:serviceId",
    async ({ params, set }) => {
      const db = createDb();
      try {
        const service = await getServiceStatus(db, params.serviceId);
        if (!service) {
          set.status = 404;
          return { error: "Service not found" };
        }
        return { data: service };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: serviceIdParamSchema,
    }
  )

  .get(
    "/:serviceId/info",
    async ({ params, set }) => {
      const db = createDb();
      try {
        const info = await getServiceInfo(db, params.serviceId);
        return { data: info };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: serviceIdParamSchema,
    }
  )

  .post(
    "/:serviceId/start",
    async ({ params, set }) => {
      const db = createDb();
      try {
        const info = await getServiceInfo(db, params.serviceId);
        const service = await db.query.services.findFirst({
          where: eq(schema.services.id, params.serviceId),
        });

        if (!service) {
          set.status = 404;
          return { error: "Service not found" };
        }

        await startService(db, {
          id: params.serviceId,
          constructId: service.constructId,
          serviceName: service.serviceName,
          serviceType:
            (service.serviceType as "process" | "docker" | "compose") ||
            "process",
          command: info.command,
          cwd: info.cwd,
          env: info.env,
          ports: info.ports,
        });

        const updatedService = await getServiceStatus(db, params.serviceId);
        return { data: updatedService };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: serviceIdParamSchema,
    }
  )

  .post(
    "/:serviceId/stop",
    async ({ params, set }) => {
      const db = createDb();
      try {
        await stopService(db, params.serviceId);
        const updatedService = await getServiceStatus(db, params.serviceId);
        return { data: updatedService };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: serviceIdParamSchema,
    }
  )

  .post(
    "/:serviceId/restart",
    async ({ params, set }) => {
      const db = createDb();
      try {
        await restartService(db, params.serviceId);
        const updatedService = await getServiceStatus(db, params.serviceId);
        return { data: updatedService };
      } catch (error) {
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      params: serviceIdParamSchema,
    }
  )

  .post("/check-all", async ({ set }) => {
    const db = createDb();
    try {
      await checkAllServices(db);
      return { message: "Service status check completed" };
    } catch (error) {
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
