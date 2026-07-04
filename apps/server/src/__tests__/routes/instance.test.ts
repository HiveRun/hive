import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInstanceRoutes } from "../../routes/instance";
import { captureEnv, setEnv } from "../env-test-helpers";
import { setupTestDb, testDb } from "../test-db";
import {
  clearRouteServicesAndCells,
  expectJsonPayload,
  handleRouteRequest,
  seedRouteCellAndService,
} from "./cells-route-test-helpers";

const TEST_PUBLIC_API_URL = "https://instance.example.test";
const TEST_PUBLIC_WEB_URL = "https://web.instance.example.test";

describe("instance routes", () => {
  let app: Elysia;
  let tempHiveHome: string;
  let restoreEnv: () => void;

  beforeAll(setupTestDb);

  beforeEach(async () => {
    await clearRouteServicesAndCells();
    tempHiveHome = mkdtempSync(join(tmpdir(), "hive-instance-route-"));
    restoreEnv = captureEnv([
      "HIVE_DEPLOYMENT_KIND",
      "HIVE_HOME",
      "HIVE_INSTANCE_MODE",
      "HIVE_PUBLIC_API_URL",
      "HIVE_PUBLIC_WEB_URL",
    ]);
    setEnv("HIVE_HOME", tempHiveHome);
    setEnv("HIVE_PUBLIC_API_URL", TEST_PUBLIC_API_URL);
    app = new Elysia().use(createInstanceRoutes({ db: testDb }));
  });

  afterEach(() => {
    restoreEnv();
    rmSync(tempHiveHome, { recursive: true, force: true });
  });

  it("returns stable local instance metadata", async () => {
    const first = await expectJsonPayload<{
      apiBaseUrl: string;
      capabilities: {
        access: { assumption: string };
        auth: { mode: string };
        publicInternetSafe: boolean;
      };
      id: string;
      mode: string;
      name: string;
      rootPath: string;
      warnings: string[];
      webBaseUrl: string;
    }>(await handleRouteRequest(app, "/api/instance"));
    const second = await expectJsonPayload<{ id: string }>(
      await handleRouteRequest(app, "/api/instance")
    );

    expect(first.id).toBe(second.id);
    expect(first.name).toBe("Local Hive");
    expect(first.mode).toBe("local");
    expect(first.rootPath).toBe(tempHiveHome);
    expect(first.apiBaseUrl).toBe(TEST_PUBLIC_API_URL);
    expect(first.webBaseUrl).toBe(TEST_PUBLIC_API_URL);
    expect(first.capabilities.auth.mode).toBe("none");
    expect(first.capabilities.access.assumption).toBe("local");
    expect(first.capabilities.publicInternetSafe).toBe(false);
    expect(first.warnings).toEqual([]);
  });

  it("returns private remote warnings and public web url", async () => {
    setEnv("HIVE_INSTANCE_MODE", "private-remote");
    setEnv("HIVE_DEPLOYMENT_KIND", "docker-compose");
    setEnv("HIVE_PUBLIC_WEB_URL", TEST_PUBLIC_WEB_URL);

    const payload = await expectJsonPayload<{
      capabilities: {
        access: { assumption: string };
        deployment: { kind: string };
        publicInternetSafe: boolean;
      };
      mode: string;
      name: string;
      warnings: string[];
      webBaseUrl: string;
    }>(await handleRouteRequest(app, "/api/instance"));

    expect(payload.name).toBe("Private Remote Hive");
    expect(payload.mode).toBe("private-remote");
    expect(payload.webBaseUrl).toBe(TEST_PUBLIC_WEB_URL);
    expect(payload.capabilities.access.assumption).toBe("private-network");
    expect(payload.capabilities.deployment.kind).toBe("docker-compose");
    expect(payload.capabilities.publicInternetSafe).toBe(false);
    expect(payload.warnings[0]).toContain("no built-in authentication");
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
