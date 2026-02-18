import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import type { DatabaseService as DatabaseServiceType } from "../db";
import {
  ACTIVITY_EVENT_TYPES,
  type ActivityEventType,
  cellActivityEvents,
} from "../schema/activity-events";

type DatabaseClient = DatabaseServiceType["db"];

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 200;

export type ActivityCursor = {
  createdAt: Date;
  id: string;
};

export type CellActivityPage = {
  events: Array<{
    id: string;
    cellId: string;
    serviceId: string | null;
    type: ActivityEventType;
    source: string | null;
    toolName: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  nextCursor: string | null;
};

export function encodeActivityCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}:${id}`;
}

export function parseActivityCursor(cursor: string): ActivityCursor {
  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error("Invalid cursor");
  }

  const millis = Number(cursor.slice(0, separatorIndex));
  const id = cursor.slice(separatorIndex + 1);
  if (!(Number.isFinite(millis) && id.length)) {
    throw new Error("Invalid cursor");
  }

  return { createdAt: new Date(millis), id };
}

export function normalizeActivityLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ACTIVITY_LIMIT);
}

export function normalizeActivityTypes(
  types?: string
): ActivityEventType[] | null {
  if (!types) {
    return null;
  }

  const allowed = new Set<string>(ACTIVITY_EVENT_TYPES);
  const filtered = types
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.has(value));

  return filtered.length ? (filtered as ActivityEventType[]) : null;
}

export async function fetchCellActivityPage(args: {
  database: DatabaseClient;
  cellId: string;
  limit: number;
  types: ActivityEventType[] | null;
  cursor: ActivityCursor | null;
}): Promise<CellActivityPage> {
  const whereClause = and(
    eq(cellActivityEvents.cellId, args.cellId),
    args.types ? inArray(cellActivityEvents.type, args.types) : undefined,
    args.cursor
      ? or(
          lt(cellActivityEvents.createdAt, args.cursor.createdAt),
          and(
            eq(cellActivityEvents.createdAt, args.cursor.createdAt),
            lt(cellActivityEvents.id, args.cursor.id)
          )
        )
      : undefined
  );

  const rows = await args.database
    .select()
    .from(cellActivityEvents)
    .where(whereClause)
    .orderBy(desc(cellActivityEvents.createdAt), desc(cellActivityEvents.id))
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const slice = hasMore ? rows.slice(0, args.limit) : rows;
  const nextCursor = hasMore
    ? (() => {
        const last = slice.at(-1);
        if (!last) {
          return null;
        }
        return encodeActivityCursor(last.createdAt, last.id);
      })()
    : null;

  return {
    events: slice.map((event) => ({
      id: event.id,
      cellId: event.cellId,
      serviceId: event.serviceId,
      type: event.type,
      source: event.source,
      toolName: event.toolName,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
    nextCursor,
  };
}
