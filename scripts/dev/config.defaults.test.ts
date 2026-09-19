import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_READY_TIMEOUT_MS } from "../../apps/server/src/config/service-graph";
import { hiveConfigDefaults } from "./config.defaults";

const MINIMUM_COLD_START_TIMEOUT_MS = 30_000;
const turboConfig = JSON.parse(
  readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")
) as { tasks: Record<string, { env?: string[] }> };
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { scripts: Record<string, string> };

describe("default Hive configuration", () => {
  it("allows development services enough time for a cold start", () => {
    expect(DEFAULT_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(
      MINIMUM_COLD_START_TIMEOUT_MS
    );

    for (const template of Object.values(hiveConfigDefaults.templates)) {
      for (const service of Object.values(template.services ?? {})) {
        if (service.type === "process") {
          expect(service.readyTimeoutMs).toBe(DEFAULT_READY_TIMEOUT_MS);
        }
      }
    }
  });

  it("forwards the development database path through Turbo migrations", () => {
    expect(hiveConfigDefaults.templates["hive-dev"]?.env?.DATABASE_URL).toBe(
      "local.db"
    );
    expect(turboConfig.tasks["db:migrate"]?.env).toContain("DATABASE_URL");
    expect(packageJson.scripts["db:migrate"]).toContain("--no-daemon");
  });

  it("forwards desktop development isolation through Turbo", () => {
    expect(turboConfig.tasks.dev?.env).toEqual(
      expect.arrayContaining([
        "HIVE_DESKTOP_API_PORT",
        "HIVE_DESKTOP_DEV_HOST",
        "HIVE_DESKTOP_DEV_PORT",
        "HIVE_DESKTOP_RENDERER_READY_FILE",
        "HIVE_DESKTOP_READY_TOKEN",
        "HIVE_CELLS_ROOT",
        "HIVE_HOME",
        "HIVE_READY_FILE",
        "HIVE_WORKSPACE_ROOT",
        "VITE_API_URL",
        "WEB_PORT",
      ])
    );
  });
});
