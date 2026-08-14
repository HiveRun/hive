import { and, eq, inArray } from "drizzle-orm";
import type { Cell } from "../schema/cells";
import { cells } from "../schema/cells";
import type { CellService, CellServicePort } from "../schema/services";
import { cellServicePorts, cellServices } from "../schema/services";

type DbClient = typeof import("../db").db;

type ServiceRow = {
  service: CellService;
  cell: Cell;
};

export function createServiceRepository(database: DbClient, now: () => Date) {
  async function findByCellAndName(
    cellId: string,
    serviceName: string
  ): Promise<CellService | undefined> {
    const [record] = await database
      .select()
      .from(cellServices)
      .where(
        and(eq(cellServices.cellId, cellId), eq(cellServices.name, serviceName))
      )
      .limit(1);

    return record;
  }

  async function insertService(
    cell: Cell,
    data: Omit<CellService, "id" | "cellId" | "createdAt" | "updatedAt"> & {
      id: string;
    }
  ) {
    const timestamp = now();
    const [record] = await database
      .insert(cellServices)
      .values({
        ...data,
        cellId: cell.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    return record;
  }

  async function updateService(
    serviceId: string,
    update: Partial<CellService>
  ) {
    const [record] = await database
      .update(cellServices)
      .set({ ...update, updatedAt: now() })
      .where(eq(cellServices.id, serviceId))
      .returning();

    return record;
  }

  async function markError(serviceId: string, message: string): Promise<void> {
    await database
      .update(cellServices)
      .set({
        status: "error",
        pid: null,
        lastKnownError: message,
        updatedAt: now(),
      })
      .where(eq(cellServices.id, serviceId));
  }

  async function fetchServiceRowById(
    serviceId: string
  ): Promise<ServiceRow | undefined> {
    const [row] = await database
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId))
      .where(eq(cellServices.id, serviceId))
      .limit(1);

    return row ? mapRow(row) : undefined;
  }

  async function fetchServicesForCell(cellId: string): Promise<ServiceRow[]> {
    const rows = await database
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId))
      .where(eq(cellServices.cellId, cellId));

    return rows.map(mapRow);
  }

  async function fetchAllServices(): Promise<ServiceRow[]> {
    const rows = await database
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId));

    return rows.map(mapRow);
  }

  async function fetchPortsForService(
    serviceId: string
  ): Promise<CellServicePort[]> {
    return await database
      .select()
      .from(cellServicePorts)
      .where(eq(cellServicePorts.serviceId, serviceId));
  }

  async function fetchPortsForServices(
    serviceIds: string[]
  ): Promise<CellServicePort[]> {
    if (serviceIds.length === 0) {
      return [];
    }
    return await database
      .select()
      .from(cellServicePorts)
      .where(inArray(cellServicePorts.serviceId, serviceIds));
  }

  async function fetchAllPorts(): Promise<CellServicePort[]> {
    return await database.select().from(cellServicePorts);
  }

  async function reconcileServicePorts(args: {
    serviceId: string;
    primaryPort: number;
    ports: Array<{ name: string; port: number; primary: boolean }>;
  }): Promise<void> {
    const timestamp = now();
    await database.transaction(async (transaction) => {
      await transaction
        .delete(cellServicePorts)
        .where(eq(cellServicePorts.serviceId, args.serviceId));
      await transaction.insert(cellServicePorts).values(
        args.ports.map((port) => ({
          serviceId: args.serviceId,
          name: port.name,
          port: port.port,
          primary: port.primary,
          createdAt: timestamp,
          updatedAt: timestamp,
        }))
      );
      await transaction
        .update(cellServices)
        .set({ port: args.primaryPort, updatedAt: timestamp })
        .where(eq(cellServices.id, args.serviceId));
    });
  }

  return {
    findByCellAndName,
    insertService,
    updateService,
    markError,
    fetchServiceRowById,
    fetchServicesForCell,
    fetchAllServices,
    fetchPortsForService,
    fetchPortsForServices,
    fetchAllPorts,
    reconcileServicePorts,
  };
}

function mapRow(row: { cell_services: CellService; cells: Cell }): ServiceRow {
  return {
    service: row.cell_services,
    cell: row.cells,
  };
}
