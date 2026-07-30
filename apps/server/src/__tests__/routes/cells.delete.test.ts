import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cells } from "../../schema/cells";
import { ensureCellEnvironment } from "../../services/cell-environment";
import { setupTestDb, testDb } from "../test-db";
import {
  createBlockedServiceStop,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createResolvedCleanupMocks,
  deleteRouteCellById,
  seedRouteCell,
} from "./cells-route-test-helpers";

const CELL_ID = "delete-teardown-cell";
const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;
const originalHiveHome = process.env.HIVE_HOME;

const loadDeleteCell = async () => {
  const [cell] = await testDb.select().from(cells).where(eq(cells.id, CELL_ID));
  return cell;
};

const createDeleteTestApp = (overrides: Record<string, unknown>) =>
  createCellRouteTestApp(
    createCellRouteTestDependencies({ cellId: CELL_ID, overrides })
  );

const seedDeleteCell = async (name: string, withArtifacts = false) => {
  await seedRouteCell({ id: CELL_ID, name });
  const environment = ensureCellEnvironment(CELL_ID, "/tmp/mock-worktree");
  if (withArtifacts) {
    await Promise.all([
      writeFile(
        join(environment.HIVE_CELL_RUNTIME_DIR, "runtime.txt"),
        "runtime"
      ),
      writeFile(
        join(environment.HIVE_CELL_ARTIFACTS_DIR, "artifact.txt"),
        "artifact"
      ),
    ]);
  }
  return environment;
};

describe("cell deletion teardown lifecycle", () => {
  let hiveHome: string;

  beforeAll(setupTestDb);

  beforeEach(async () => {
    await testDb.delete(cells);
    hiveHome = await mkdtemp(join(tmpdir(), "hive-delete-lifecycle-"));
    process.env.HIVE_HOME = hiveHome;
  });

  afterEach(async () => {
    process.env.HIVE_HOME = originalHiveHome;
    await rm(hiveHome, { recursive: true, force: true });
  });

  it("retains a failed cell and retries teardown before destructive removal", async () => {
    const environment = await seedDeleteCell("Delete teardown", true);

    const order: string[] = [];
    const stopServicesForCell = vi.fn(() => {
      order.push("stop");
      return Promise.resolve();
    });
    const runCellTeardown = vi.fn(() => {
      order.push("teardown");
      if (runCellTeardown.mock.calls.length === 1) {
        return Promise.reject(new Error("cleanup database unavailable"));
      }
      return Promise.resolve();
    });
    const removeWorktree = vi.fn(async () => {
      order.push("remove_worktree");
      await expect(access(environment.HIVE_CELL_RUNTIME_DIR)).rejects.toThrow();
      await access(environment.HIVE_CELL_ARTIFACTS_DIR);
    });
    const app = createDeleteTestApp({
      stopServicesForCell,
      runCellTeardown,
      removeWorktree,
    });

    const failedDelete = await deleteRouteCellById(app, CELL_ID);
    expect(failedDelete.status).toBe(HTTP_INTERNAL_ERROR);
    expect((await failedDelete.json()) as { message: string }).toEqual({
      message:
        "Failed to delete cell: Template teardown failed during cell deletion: cleanup database unavailable",
    });
    expect(order).toEqual(["stop", "teardown"]);
    expect(removeWorktree).not.toHaveBeenCalled();
    await access(environment.HIVE_CELL_RUNTIME_DIR);

    const retained = await loadDeleteCell();
    expect(retained).toMatchObject({ status: "error" });
    expect(retained?.lastSetupError).toContain("cleanup database unavailable");

    const retriedDelete = await deleteRouteCellById(app, CELL_ID);
    expect(retriedDelete.status).toBe(HTTP_OK);
    expect(order).toEqual([
      "stop",
      "teardown",
      "stop",
      "teardown",
      "remove_worktree",
    ]);
    expect(runCellTeardown).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "delete" })
    );
    expect(
      await testDb.select().from(cells).where(eq(cells.id, CELL_ID))
    ).toHaveLength(0);
    await expect(access(environment.HIVE_CELL_RUNTIME_DIR)).rejects.toThrow();
    await access(environment.HIVE_CELL_ARTIFACTS_DIR);
  });

  it("does not run teardown or remove resources after service stop fails", async () => {
    const environment = await seedDeleteCell("Delete stop failure");
    const { runCellTeardown, removeWorktree } = createResolvedCleanupMocks();
    const closeAgentSession = vi.fn(() =>
      Promise.reject(new Error("close session failed"))
    );
    const app = createDeleteTestApp({
      stopServicesForCell: () =>
        Promise.reject(new Error("service stop timed out")),
      closeAgentSession,
      runCellTeardown,
      removeWorktree,
    });

    const response = await deleteRouteCellById(app, CELL_ID);

    expect(response.status).toBe(HTTP_INTERNAL_ERROR);
    expect(closeAgentSession).toHaveBeenCalledWith(CELL_ID);
    expect(runCellTeardown).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    await access(environment.HIVE_CELL_RUNTIME_DIR);
    const retained = await loadDeleteCell();
    expect(retained).toMatchObject({ status: "error" });
    expect(retained?.lastSetupError).toContain("service stop timed out");
  });

  it("serializes concurrent deletion lifecycles for the same cell", async () => {
    await seedDeleteCell("Concurrent delete");
    const blockedStop = createBlockedServiceStop();
    const stopServicesForCell = blockedStop.stop;
    const { runCellTeardown, removeWorktree } = createResolvedCleanupMocks();
    const app = createDeleteTestApp({
      stopServicesForCell,
      runCellTeardown,
      removeWorktree,
    });

    const firstDelete = deleteRouteCellById(app, CELL_ID);
    await blockedStop.started.promise;
    const secondDelete = deleteRouteCellById(app, CELL_ID);
    blockedStop.released.resolve();

    const [firstResponse, secondResponse] = await Promise.all([
      firstDelete,
      secondDelete,
    ]);
    expect(firstResponse.status).toBe(HTTP_OK);
    expect(secondResponse.status).toBe(HTTP_OK);
    expect(stopServicesForCell).toHaveBeenCalledOnce();
    expect(runCellTeardown).toHaveBeenCalledOnce();
    expect(removeWorktree).toHaveBeenCalledOnce();
    expect(
      await testDb.select().from(cells).where(eq(cells.id, CELL_ID))
    ).toHaveLength(0);
  });
});
