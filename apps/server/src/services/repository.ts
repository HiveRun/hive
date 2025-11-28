import { and, eq } from "drizzle-orm";
import type { Cell } from "../schema/cells";
import { cells } from "../schema/cells";
import type { CellService } from "../schema/services";
import { cellServices } from "../schema/services";

type DbClient = typeof import("../db").db;

type ServiceRow = {
  service: CellService;
  cell: Cell;
};

export function createServiceRepository(db: DbClient, now: () => Date) {
  async function findByCellAndName(
    cellId: string,
    serviceName: string
  ): Promise<CellService | undefined> {
    const [record] = await db
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
    const [record] = await db
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
    const [record] = await db
      .update(cellServices)
      .set({ ...update, updatedAt: now() })
      .where(eq(cellServices.id, serviceId))
      .returning();

    return record;
  }

  async function markError(serviceId: string, message: string): Promise<void> {
    await db
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
    const [row] = await db
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId))
      .where(eq(cellServices.id, serviceId))
      .limit(1);

    return row ? mapRow(row) : undefined;
  }

  async function fetchServicesForCell(cellId: string): Promise<ServiceRow[]> {
    const rows = await db
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId))
      .where(eq(cellServices.cellId, cellId));

    return rows.map(mapRow);
  }

  async function fetchAllServices(): Promise<ServiceRow[]> {
    const rows = await db
      .select()
      .from(cellServices)
      .innerJoin(cells, eq(cells.id, cellServices.cellId));

    return rows.map(mapRow);
  }

  return {
    findByCellAndName,
    insertService,
    updateService,
    markError,
    fetchServiceRowById,
    fetchServicesForCell,
    fetchAllServices,
  };
}

function mapRow(row: { cell_services: CellService; cells: Cell }): ServiceRow {
  return {
    service: row.cell_services,
    cell: row.cells,
  };
}
