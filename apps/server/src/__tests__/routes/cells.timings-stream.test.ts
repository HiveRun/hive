import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cells } from "../../schema/cells";
import { emitCellTimingUpdate } from "../../services/events";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  expectEventStreamHeaders,
  expectEventStreamResponse,
  expectReadyAndSnapshotEvents,
  expectStreamEvent,
  handleRouteRequest,
  seedRouteCell,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const HTTP_NOT_FOUND = 404;

const createTestApp = () =>
  createCellRouteTestApp(
    createCellRouteTestDependencies({ cellId: TEST_CELL_ID })
  );

const seedCell = () =>
  seedRouteCell({ id: TEST_CELL_ID, name: "Timing Cell", status: "spawning" });

describe("Cell timings stream route", () => {
  beforeAll(setupTestDb);

  beforeEach(() => testDb.delete(cells));

  it("streams timing events after ready/snapshot", async () => {
    await seedCell();
    const app = createTestApp();

    const response = await handleRouteRequest(
      app,
      `/api/cells/${TEST_CELL_ID}/timings/stream?workflow=create`
    );

    expectEventStreamHeaders(response);

    const reader = await expectEventStreamResponse(response);
    await expectReadyAndSnapshotEvents(reader);

    emitCellTimingUpdate({
      cellId: TEST_CELL_ID,
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    const timingText = await expectStreamEvent(reader, "timing");
    expect(timingText).toContain('"workflow":"create"');
    expect(timingText).toContain('"step":"create_worktree"');
  });

  it("returns 404 when the cell does not exist", async () => {
    const app = createTestApp();

    const response = await handleRouteRequest(
      app,
      "/api/cells/missing/timings/stream"
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });
});
