import {
  HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ,
  HIVE_ANDROID_CONSOLE_PORT_MIN,
  HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS,
  HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES,
  resolveHiveAndroidAvdName,
  resolveHiveAndroidSerial,
} from "@hive/android-runtime/facts";
import { describe, expect, it } from "vitest";
import {
  clampRuntimeStep,
  getRuntimeNodeStates,
  getRuntimeScenario,
  getRuntimeStep,
  isRuntimeFaultActive,
  RUNTIME_EDGE_IDS,
  RUNTIME_NODE_IDS,
  RUNTIME_SCENARIOS,
} from "./android-runtime-lab";

const NEGATIVE_STEP = -4;
const MIDDLE_STEP = 2;
const OUT_OF_RANGE_STEP = 999;
const HERTZ_PER_KILOHERTZ = 1000;

describe("Android runtime lab model", () => {
  it("defines complete, internally valid scenarios", () => {
    const nodeIds = new Set(RUNTIME_NODE_IDS);
    const edgeIds = new Set(RUNTIME_EDGE_IDS);

    expect(RUNTIME_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "cold-start",
      "microphone",
      "viewer-restart",
      "stale-recovery",
      "adb-isolation",
    ]);

    for (const scenario of RUNTIME_SCENARIOS) {
      expect(scenario.steps.length).toBeGreaterThan(0);
      expect(scenario.fault.step).toBeLessThan(scenario.steps.length);
      for (const step of scenario.steps) {
        expect(step.activeNodes.every((id) => nodeIds.has(id))).toBe(true);
        expect(step.activeEdges.every((id) => edgeIds.has(id))).toBe(true);
      }
    }
  });

  it("renders production-owned runtime facts instead of copying constants", () => {
    const coldStart = getRuntimeScenario("cold-start");
    const microphone = getRuntimeScenario("microphone");

    expect(coldStart.steps[1]?.event).toContain(
      String(HIVE_ANDROID_CONSOLE_PORT_MIN)
    );
    expect(coldStart.steps[2]?.event).toContain(
      resolveHiveAndroidAvdName("cell-a")
    );
    expect(coldStart.steps[2]?.telemetry.serial).toContain(
      resolveHiveAndroidSerial(HIVE_ANDROID_CONSOLE_PORT_MIN)
    );
    expect(microphone.steps[2]?.event).toContain(
      `${HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS} ms`
    );
    expect(microphone.steps[2]?.event).toContain(
      `${HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ / HERTZ_PER_KILOHERTZ} kHz`
    );
    expect(microphone.steps[2]?.checks).toContain(
      `${HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES} samples per frame`
    );
  });

  it("clamps URL step indexes to the selected scenario", () => {
    const scenario = getRuntimeScenario("microphone");

    expect(clampRuntimeStep(scenario, NEGATIVE_STEP)).toBe(0);
    expect(clampRuntimeStep(scenario, MIDDLE_STEP)).toBe(MIDDLE_STEP);
    expect(clampRuntimeStep(scenario, OUT_OF_RANGE_STEP)).toBe(
      scenario.steps.length - 1
    );
    expect(getRuntimeStep(scenario, OUT_OF_RANGE_STEP)).toBe(
      scenario.steps.at(-1)
    );
  });

  it("applies fault state only at and after the injection step", () => {
    const scenario = getRuntimeScenario("adb-isolation");
    const beforeFault = scenario.fault.step - 1;

    expect(isRuntimeFaultActive(scenario, beforeFault, true)).toBe(false);
    expect(getRuntimeNodeStates(scenario, beforeFault, true).product).not.toBe(
      "failed"
    );

    expect(isRuntimeFaultActive(scenario, scenario.fault.step, true)).toBe(
      true
    );
    expect(
      getRuntimeNodeStates(scenario, scenario.fault.step, true).product
    ).toBe("failed");
    expect(
      getRuntimeNodeStates(scenario, scenario.fault.step, false).product
    ).toBe("active");
  });
});
