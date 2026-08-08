import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { isAndroidDeviceReady } from "./android-device";

const EXECUTABLE_MODE = 0o755;

describe("Android device readiness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { force: true, recursive: true });
    }
  });

  const createAdb = async (state: string, bootCompleted: string) => {
    const root = await mkdtemp("/tmp/hive-adb-ready-test-");
    roots.push(root);
    const adbPath = `${root}/adb`;
    await writeFile(
      adbPath,
      `#!/bin/sh
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nemulator-5580\\t${state}\\n'
  exit 0
fi
if [ "$*" = "-s emulator-5580 shell getprop sys.boot_completed" ]; then
  printf '${bootCompleted}\\n'
  exit 0
fi
exit 1
`
    );
    await chmod(adbPath, EXECUTABLE_MODE);
    return adbPath;
  };

  it("requires both ADB device state and Android boot completion", async () => {
    expect(
      isAndroidDeviceReady(await createAdb("offline", "1"), "emulator-5580", {})
    ).toBe(false);
    expect(
      isAndroidDeviceReady(await createAdb("device", "0"), "emulator-5580", {})
    ).toBe(false);
    expect(
      isAndroidDeviceReady(await createAdb("device", "1"), "emulator-5580", {})
    ).toBe(true);
  });
});
