import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInstanceRoutes } from "../../routes/instance";
import { setupTestDb, testDb } from "../test-db";
import {
  clearRouteServicesAndCells,
  expectJsonPayload,
  handleRouteRequest,
  seedRouteCellAndService,
} from "./cells-route-test-helpers";

const TEST_PUBLIC_API_URL = "https://instance.example.test";

describe("instance routes", () => {
  let app: Elysia;
  let tempHiveHome: string;
  let previousHiveHome: string | undefined;
  let previousPublicApiUrl: string | undefined;

  beforeAll(setupTestDb);

  beforeEach(async () => {
    await clearRouteServicesAndCells();
    previousHiveHome = process.env.HIVE_HOME;
    previousPublicApiUrl = process.env.HIVE_PUBLIC_API_URL;
    tempHiveHome = mkdtempSync(join(tmpdir(), "hive-instance-route-"));
    process.env.HIVE_HOME = tempHiveHome;
    process.env.HIVE_PUBLIC_API_URL = TEST_PUBLIC_API_URL;
    app = new Elysia().use(createInstanceRoutes({ db: testDb }));
  });

  afterEach(() => {
    if (previousHiveHome === undefined) {
      process.env.HIVE_HOME = undefined;
    } else {
      process.env.HIVE_HOME = previousHiveHome;
    }
    if (previousPublicApiUrl === undefined) {
      process.env.HIVE_PUBLIC_API_URL = undefined;
    } else {
      process.env.HIVE_PUBLIC_API_URL = previousPublicApiUrl;
    }
    rmSync(tempHiveHome, { recursive: true, force: true });
  });

  it("returns stable local instance metadata", async () => {
    const first = await expectJsonPayload<{
      apiBaseUrl: string;
      id: string;
      mode: string;
      name: string;
      rootPath: string;
    }>(await handleRouteRequest(app, "/api/instance"));
    const second = await expectJsonPayload<{ id: string }>(
      await handleRouteRequest(app, "/api/instance")
    );

    expect(first.id).toBe(second.id);
    expect(first.name).toBe("Local Hive");
    expect(first.mode).toBe("local");
    expect(first.rootPath).toBe(tempHiveHome);
    expect(first.apiBaseUrl).toBe(TEST_PUBLIC_API_URL);
  });

  it("returns instance overview counts without actor attribution", async () => {
    await seedRouteCellAndService({
      cell: {
        id: "instance-overview-cell",
        name: "Instance Overview Cell",
        description: "overview test",
        templateId: "template",
        workspaceId: "workspace",
        workspaceRootPath: "/tmp/workspace",
        workspacePath: "/tmp/workspace/cell",
        status: "ready",
      },
      service: {
        id: "instance-overview-service",
        cellId: "instance-overview-cell",
        name: "web",
        command: "bun dev",
        cwd: "/tmp/workspace/cell",
        env: {},
        definitionEnv: {},
        status: "running",
        port: 3001,
      },
    });

    const overview = await expectJsonPayload<{
      cells: { byStatus: Record<string, number>; total: number };
      services: { byStatus: Record<string, number>; total: number };
      workspaces: { total: number };
    }>(await handleRouteRequest(app, "/api/instance/overview"));

    expect(overview.workspaces.total).toBe(0);
    expect(overview.cells.total).toBe(1);
    expect(overview.cells.byStatus.ready).toBe(1);
    expect(overview.services.total).toBe(1);
    expect(overview.services.byStatus.running).toBe(1);
  });
});
