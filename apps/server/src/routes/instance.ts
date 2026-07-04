import { desc } from "drizzle-orm";
import { Elysia } from "elysia";
import {
  DatabaseService,
  type DatabaseService as DatabaseServiceType,
} from "../db";
import { getHiveInstanceMetadata } from "../instance/metadata";
import { resolvePublicApiBaseUrl } from "../instance/public-url";
import { cellActivityEvents } from "../schema/activity-events";
import {
  InstanceOverviewResponseSchema,
  InstanceResponseSchema,
} from "../schema/api";
import { cells } from "../schema/cells";
import { cellServices } from "../schema/services";
import { getWorkspaceRegistry } from "../workspaces/registry";

type DatabaseClient = DatabaseServiceType["db"];

type InstanceRouteDependencies = {
  db: DatabaseClient;
};

const buildStatusCounts = (records: Array<{ status: string }>) => {
  const byStatus: Record<string, number> = {};
  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  return byStatus;
};

const toInstanceResponse = async () => {
  const metadata = await getHiveInstanceMetadata();
  return {
    ...metadata,
    apiBaseUrl: resolvePublicApiBaseUrl(),
    pid: process.pid,
    version: process.env.HIVE_VERSION ?? "dev",
  };
};

export function createInstanceRoutes(
  overrides: Partial<InstanceRouteDependencies> = {}
) {
  const deps: InstanceRouteDependencies = {
    db: overrides.db ?? DatabaseService.db,
  };

  return new Elysia({ prefix: "/api/instance" })
    .get("/", async () => await toInstanceResponse(), {
      response: {
        200: InstanceResponseSchema,
      },
    })
    .get(
      "/overview",
      async () => {
        const [
          instance,
          workspaceRegistry,
          cellRows,
          serviceRows,
          activityRows,
        ] = await Promise.all([
          toInstanceResponse(),
          getWorkspaceRegistry(),
          deps.db.select({ status: cells.status }).from(cells),
          deps.db.select({ status: cellServices.status }).from(cellServices),
          deps.db
            .select({
              id: cellActivityEvents.id,
              cellId: cellActivityEvents.cellId,
              serviceId: cellActivityEvents.serviceId,
              type: cellActivityEvents.type,
              source: cellActivityEvents.source,
              toolName: cellActivityEvents.toolName,
              createdAt: cellActivityEvents.createdAt,
            })
            .from(cellActivityEvents)
            .orderBy(desc(cellActivityEvents.createdAt))
            .limit(10),
        ]);

        return {
          instance,
          workspaces: {
            total: workspaceRegistry.workspaces.length,
            activeWorkspaceId: workspaceRegistry.activeWorkspaceId ?? null,
          },
          cells: {
            total: cellRows.length,
            byStatus: buildStatusCounts(cellRows),
          },
          services: {
            total: serviceRows.length,
            byStatus: buildStatusCounts(serviceRows),
          },
          activity: {
            recent: activityRows.map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
            })),
          },
        };
      },
      {
        response: {
          200: InstanceOverviewResponseSchema,
        },
      }
    );
}

export const instanceRoutes = createInstanceRoutes();
