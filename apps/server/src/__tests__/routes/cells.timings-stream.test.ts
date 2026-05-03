// jscpd:ignore-start
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cells } from "../../schema/cells";
import { emitCellTimingUpdate } from "../../services/events";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  expectEventStreamResponse,
  seedRouteCell,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const createMinimalDependencies = () =>
  createCellRouteTestDependencies({ cellId: TEST_CELL_ID });
const createTestApp = () => createCellRouteTestApp(createMinimalDependencies());

const seedCell = () =>
  seedRouteCell({ id: TEST_CELL_ID, name: "Timing Cell", status: "spawning" });

describe("Cell timings stream route", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("streams timing events after ready/snapshot", async () => {
    await seedCell();
    const app = createTestApp();

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/timings/stream?workflow=create`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = await expectEventStreamResponse(response);
    const readyText = await reader.read();
    expect(readyText).toContain("event: ready");

    const snapshotText = await reader.read();
    expect(snapshotText).toContain("event: snapshot");

    emitCellTimingUpdate({
      cellId: TEST_CELL_ID,
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    const timingText = await reader.read();
    expect(timingText).toContain("event: timing");
    expect(timingText).toContain('"workflow":"create"');
    expect(timingText).toContain('"step":"create_worktree"');
  });

  it("returns 404 when the cell does not exist", async () => {
    const app = createTestApp();

    const response = await app.handle(
      new Request("http://localhost/api/cells/missing/timings/stream")
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });
});
// jscpd:ignore-end
