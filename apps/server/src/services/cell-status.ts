import { eq } from "drizzle-orm";
import type { DatabaseService as DatabaseServiceType } from "../db";
import { type CellStatus, cells } from "../schema/cells";
import { emitCellStatusUpdate } from "./events";

type DatabaseClient = DatabaseServiceType["db"];

export async function updateCellStatusAndEmit(args: {
  database: DatabaseClient;
  cell: Pick<typeof cells.$inferSelect, "id" | "workspaceId">;
  status: CellStatus;
  lastSetupError?: string | null;
}) {
  await args.database
    .update(cells)
    .set({ status: args.status, lastSetupError: args.lastSetupError })
    .where(eq(cells.id, args.cell.id));
  emitCellStatusUpdate({
    workspaceId: args.cell.workspaceId,
    cellId: args.cell.id,
    status: args.status,
    lastSetupError: args.lastSetupError ?? undefined,
  });
}
