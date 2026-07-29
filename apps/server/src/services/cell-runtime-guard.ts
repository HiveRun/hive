import { eq } from "drizzle-orm";
import type { DatabaseService as DatabaseServiceType } from "../db";
import { type Cell, cells } from "../schema/cells";

type DatabaseClient = DatabaseServiceType["db"];

export async function loadCellById(
  database: DatabaseClient,
  cellId: string
): Promise<Cell | null> {
  const [cell] = await database
    .select()
    .from(cells)
    .where(eq(cells.id, cellId))
    .limit(1);
  return cell ?? null;
}

export async function requireCellAvailableForRuntime(
  database: DatabaseClient,
  cellId: string
): Promise<Cell> {
  const cell = await loadCellById(database, cellId);
  if (!cell) {
    throw new Error("Cell not found");
  }
  if (cell.status === "deleting") {
    throw new Error("Cell is being deleted");
  }
  return cell;
}
