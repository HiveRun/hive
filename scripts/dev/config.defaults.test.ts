import { describe, expect, it } from "bun:test";
import { DEFAULT_READY_TIMEOUT_MS } from "../../apps/server/src/config/service-graph";
import { hiveConfigDefaults } from "./config.defaults";

const MINIMUM_COLD_START_TIMEOUT_MS = 30_000;

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
});
