import { afterEach, expect, mock, test } from "bun:test";

const SPECIFIC_STARTUP_ERROR = "Hive daemon executable is not configured";
const originalDaemonCommand = process.env.HIVE_DESKTOP_DAEMON_COMMAND;
const originalResourcesPath = process.resourcesPath;

mock.module("@hive/daemon-runtime", () => ({
  createDaemonRuntime: (options: {
    onStatus: (event: { message: string; phase: "error" }) => void;
  }) => ({
    ensureRunning: () => {
      options.onStatus({
        message: SPECIFIC_STARTUP_ERROR,
        phase: "error",
      });
      return Promise.resolve(false);
    },
  }),
}));

const { createDesktopStartupController } = await import("./startup-controller");

afterEach(() => {
  if (originalDaemonCommand === undefined) {
    Reflect.deleteProperty(process.env, "HIVE_DESKTOP_DAEMON_COMMAND");
  } else {
    process.env.HIVE_DESKTOP_DAEMON_COMMAND = originalDaemonCommand;
  }
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: originalResourcesPath,
  });
});

test("preserves the specific daemon startup failure", async () => {
  process.env.HIVE_DESKTOP_DAEMON_COMMAND = process.execPath;
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: "/tmp",
  });
  const controller = createDesktopStartupController();

  await controller.start();

  expect(controller.getState()).toMatchObject({
    message: SPECIFIC_STARTUP_ERROR,
    phase: "error",
  });
});
