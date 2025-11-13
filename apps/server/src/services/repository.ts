import { and, eq } from "drizzle-orm";
import type { Construct } from "../schema/constructs";
import { constructs } from "../schema/constructs";
import type { ConstructService } from "../schema/services";
import { constructServices } from "../schema/services";

type DbClient = typeof import("../db").db;

type ServiceRow = {
  service: ConstructService;
  construct: Construct;
};

export function createServiceRepository(db: DbClient, now: () => Date) {
  async function findByConstructAndName(
    constructId: string,
    serviceName: string
  ): Promise<ConstructService | undefined> {
    const [record] = await db
      .select()
      .from(constructServices)
      .where(
        and(
          eq(constructServices.constructId, constructId),
          eq(constructServices.name, serviceName)
        )
      )
      .limit(1);

    return record;
  }

  async function insertService(
    construct: Construct,
    data: Omit<
      ConstructService,
      "id" | "constructId" | "createdAt" | "updatedAt"
    > & {
      id: string;
    }
  ) {
    const timestamp = now();
    const [record] = await db
      .insert(constructServices)
      .values({
        ...data,
        constructId: construct.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    return record;
  }

  async function updateService(
    serviceId: string,
    update: Partial<ConstructService>
  ) {
    const [record] = await db
      .update(constructServices)
      .set({ ...update, updatedAt: now() })
      .where(eq(constructServices.id, serviceId))
      .returning();

    return record;
  }

  async function markError(serviceId: string, message: string): Promise<void> {
    await db
      .update(constructServices)
      .set({
        status: "error",
        pid: null,
        lastKnownError: message,
        updatedAt: now(),
      })
      .where(eq(constructServices.id, serviceId));
  }

  async function fetchServiceRowById(
    serviceId: string
  ): Promise<ServiceRow | undefined> {
    const [row] = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
      .where(eq(constructServices.id, serviceId))
      .limit(1);

    return row ? mapRow(row) : undefined;
  }

  async function fetchServicesForConstruct(
    constructId: string
  ): Promise<ServiceRow[]> {
    const rows = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
      .where(eq(constructServices.constructId, constructId));

    return rows.map(mapRow);
  }

  async function fetchAllServices(): Promise<ServiceRow[]> {
    const rows = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId));

    return rows.map(mapRow);
  }

  return {
    findByConstructAndName,
    insertService,
    updateService,
    markError,
    fetchServiceRowById,
    fetchServicesForConstruct,
    fetchAllServices,
  };
}

function mapRow(row: {
  construct_services: ConstructService;
  constructs: Construct;
}): ServiceRow {
  return {
    service: row.construct_services,
    construct: row.constructs,
  };
}
