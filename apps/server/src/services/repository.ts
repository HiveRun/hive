import { and, eq } from "drizzle-orm";
import { db } from "../db";
import type { Cell } from "../schema/cells";
import { cells } from "../schema/cells";
import type { CellService } from "../schema/services";
import { cellServices } from "../schema/services";

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

export type ServiceRepositoryService = {
  readonly findByCellAndName: (
    cellId: string,
    serviceName: string
  ) => Promise<CellService | undefined>;
  readonly insertService: (
    cell: Cell,
    data: Omit<CellService, "id" | "cellId" | "createdAt" | "updatedAt"> & {
      id: string;
    }
  ) => Promise<CellService | undefined>;
  readonly updateService: (
    serviceId: string,
    update: Partial<CellService>
  ) => Promise<CellService | undefined>;
  readonly markError: (serviceId: string, message: string) => Promise<void>;
  readonly fetchServiceRowById: (
    serviceId: string
  ) => Promise<ServiceRow | undefined>;
  readonly fetchServicesForCell: (cellId: string) => Promise<ServiceRow[]>;
  readonly fetchAllServices: () => Promise<ServiceRow[]>;
};

export const serviceRepository: ServiceRepositoryService =
  createServiceRepository(db, () => new Date());

export const ServiceRepository = serviceRepository;
