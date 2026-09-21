import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Frame, type Page, test } from "@playwright/test";
import {
  type AndroidAudioVideoMetadata,
  androidAudioVideoMetadataFilename,
} from "../../../packages/android-runtime/e2e/audio-video";
import {
  adb,
  analyzePcm,
  androidAudioSampleRate,
  audioRecorderPackageName,
  buildRecorderApk,
  guestPlaybackCompletePath,
  guestPlaybackPath,
  guestPlaybackSourcePath,
  guestPlaybackStartedPath,
  guestRecordingPath,
  microphoneSpeechPilotFrequency,
  outputSpeechPilotFrequency,
  waitForRecorder,
} from "../../../packages/android-runtime/e2e/browser-microphone";
import {
  getRunningAndroidAvdName,
  parseAttachedAndroidDevices,
} from "../../../packages/android-runtime/src/android-device";
import { readAndroidRuntimeLeaseForCell } from "../../../packages/android-runtime/src/lease";
import { throwRunAndCleanupErrors } from "../src/runtime/errors";
import {
  createCellViaApi,
  fetchWorkspaceCells,
  fetchWorkspaces,
  readServicePortAssignments,
  requireApiUrl,
  requireCellPaths,
  waitForActivityTypes,
  waitForCondition,
  waitForServiceStatuses,
} from "../src/test-helpers";

const ANDROID_TEMPLATE_LABEL = "Android Audio E2E Template";
const LEGACY_ANDROID_CONSOLE_PORT = 5580;
const SERVICE_COUNT = 2;
const SERVICE_READY_TIMEOUT_MS = 600_000;
const CAPTURE_FLUSH_WAIT_MS = 500;
const MINIMUM_RMS = 0.02;
const SPEECH_ACTIVE_RMS = 0.01;
const MINIMUM_PILOT_RATIO = 0.015;
const MINIMUM_PILOT_SEPARATION = 1.4;
const MINIMUM_ACTIVE_DURATION_MS = 4000;
const SPEECH_CAPTURE_DURATION_MS = 6000;
const AUDIO_SPAN_TOLERANCE_MS = 200;
const MAXIMUM_DROPOUT_MS = 700;
const VIDEO_SYNC_SLATE_MS = 250;
const PLAYBACK_READY_TIMEOUT_MS = 30_000;
const PLAYBACK_STARTED_POLL_INTERVAL_MS = 25;
const EVIDENCE_LEAD_IN_MS = 1000;
const PCM_BYTES_PER_SAMPLE = 2;
const MILLISECONDS_PER_SECOND = 1000;
const EMULATOR_OUTPUT_CAPTURE_FILENAME = "emulator-output-stereo.pcm";
const PW_CAT_EVENTS_FILENAME = "pw-cat-events.jsonl";
const STEREO_FRAME_BYTES = 4;
const MAX_CONCURRENT_LEASE_START_SKEW_MS = 10_000;
const ADB_DEVICE_LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/;
const HTTP_NOT_FOUND = 404;

type PwCatEvent = {
  bytes: number;
  event: "start" | "exit";
  pcmPath: string;
  pid: number;
};

test.describe("production Android service audio", () => {
  test("starts concurrent cells with isolated Android emulators", async () => {
    const apiUrl = requireApiUrl();
    const { initialCellIds, workspaceId } = await readWorkspaceBaseline(apiUrl);
    const hostState = prepareAndroidE2eHostState();
    await runWithGuaranteedCleanup(
      () => runConcurrentAndroidIsolation({ apiUrl, hostState, workspaceId }),
      () =>
        cleanupAndroidE2eToBaseline({
          apiUrl,
          hostState,
          initialCellIds,
          workspaceId,
        })
    );
  });

  test("forwards browser microphone audio before and after a service restart", async ({
    page,
  }, testInfo) => {
    const videoStartedAt = await startPlaywrightVideoTimeline(page);
    const apiUrl = requireApiUrl();
    const { initialCellIds, workspaceId } = await readWorkspaceBaseline(apiUrl);
    const artifactsDir = requireEnvironment("HIVE_E2E_ARTIFACTS_DIR");
    const outputSpeechPath = requireEnvironment(
      "HIVE_E2E_ANDROID_OUTPUT_SPEECH_PATH"
    );
    const outputSpeechSource = await readFile(outputSpeechPath);
    const recorderDirectory = join(artifactsDir, "android-audio-recorder");
    await mkdir(recorderDirectory, { recursive: true });
    const recorderApk = await buildRecorderApk(recorderDirectory);
    const hostState = prepareAndroidE2eHostState();
    const { cellIds, ownedSerials, preexistingSerials, recorderSerials } =
      hostState;
    let cellId: string | null = null;

    await runWithGuaranteedCleanup(
      async () => {
        cellId = await createCellViaApi({
          apiUrl,
          name: `Android Audio E2E ${Date.now()}`,
          templateLabel: ANDROID_TEMPLATE_LABEL,
          workspaceId,
        });
        cellIds.add(cellId);
        const cellArtifactsDir = requireCellPaths(cellId).artifactsDir;
        const emulatorOutputCapturePath = join(
          cellArtifactsDir,
          EMULATOR_OUTPUT_CAPTURE_FILENAME
        );
        const pwCatEventsPath = join(cellArtifactsDir, PW_CAT_EVENTS_FILENAME);
        const initialServices = await waitForAndroidServices(apiUrl, cellId);
        const initialPwCat = await startHostPlaybackProbe(pwCatEventsPath);
        const initialAndroidLease = await waitForAndroidLease(cellId);
        process.env.ANDROID_SERIAL = initialAndroidLease.owner.serial;
        ownedSerials.add(initialAndroidLease.owner.serial);
        expect(preexistingSerials).not.toContain(
          initialAndroidLease.owner.serial
        );
        expect(initialAndroidLease.owner.consolePort).not.toBe(
          LEGACY_ANDROID_CONSOLE_PORT
        );
        const initialPids = readServicePids(initialServices);
        const initialPorts = readServicePortAssignments(initialServices);
        expect(
          initialServices.find((service) => service.name === "android")?.audio
        ).toMatchObject({ input: true, output: true });

        recorderSerials.add(initialAndroidLease.owner.serial);
        await installRecorder(recorderApk, outputSpeechPath);

        await page.addInitScript(() => {
          Object.defineProperty(globalThis, "MediaStreamTrackProcessor", {
            configurable: true,
            value: undefined,
          });
          const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices
          );
          navigator.mediaDevices.getUserMedia = async (...args) => {
            const stream = await getUserMedia(...args);
            Object.assign(window, {
              hiveMicrophoneTrack: stream.getAudioTracks()[0],
            });
            return stream;
          };
          const send = WebSocket.prototype.send;
          Object.assign(window, { hiveMicrophoneFrames: 0 });
          WebSocket.prototype.send = function patchedSend(
            this: WebSocket,
            data: string | ArrayBufferLike | Blob | ArrayBufferView
          ) {
            if (data instanceof ArrayBuffer) {
              Object.assign(window, {
                hiveMicrophoneFrames:
                  ((window as Window & { hiveMicrophoneFrames?: number })
                    .hiveMicrophoneFrames ?? 0) + 1,
              });
            }
            send.call(this, data);
          };
        });
        await page.goto("/settings");
        const preferredLabel = await selectFakeAudioInput(page);
        await page.goto(`/cells/${cellId}/viewer`);
        const firstViewer = await resolveAndroidViewer(page);
        const firstViewerUrl = await firstViewer.iframe.getAttribute("src");
        expect(
          new URL(firstViewerUrl ?? "").searchParams.get("hiveMicrophone")
        ).toBe(preferredLabel);

        const beforeCapture = await captureGuestAudio({
          artifactsDir,
          emulatorOutputCapturePath,
          frame: firstViewer.frame,
          hostPlaybackCapturePath: initialPwCat?.pcmPath,
          label: "before-restart",
          onMicrophoneCaptured: () =>
            endFallbackMicrophoneTrack(page, firstViewer.frame),
          page,
          outputSpeechSource,
          videoStartedAt,
        });
        assertPcmMetrics(beforeCapture.microphoneMetrics, "guest microphone");
        assertPcmMetrics(
          beforeCapture.outputMetrics,
          "rendered emulator output"
        );
        assertHostPlaybackMetrics(
          beforeCapture.hostPlaybackMetrics,
          "host pw-cat playback"
        );
        const initialAndroidService = initialServices.find(
          (service) => service.name === "android"
        );
        if (!initialAndroidService) {
          throw new Error("Android viewer service was not found.");
        }
        const restartResponsePromise = fetch(
          `${apiUrl}/api/cells/${cellId}/services/${initialAndroidService.id}/restart`,
          { method: "POST" }
        );
        await expect
          .poll(() => firstViewer.frame.isDetached(), {
            message:
              "Original Android viewer frame did not detach during restart",
            timeout: SERVICE_READY_TIMEOUT_MS,
          })
          .toBe(true);
        const restartResponse = await restartResponsePromise;
        expect(restartResponse.ok).toBe(true);
        await stopHostPlaybackProbe(pwCatEventsPath, initialPwCat);

        const restartedServices = await waitForAndroidServices(apiUrl, cellId);
        const restartedPwCat = await restartHostPlaybackProbe(
          pwCatEventsPath,
          initialPwCat
        );
        const restartedAndroidLease = await waitForAndroidLease(cellId);
        process.env.ANDROID_SERIAL = restartedAndroidLease.owner.serial;
        ownedSerials.add(restartedAndroidLease.owner.serial);
        expect(readServicePortAssignments(restartedServices)).toEqual(
          initialPorts
        );
        for (const service of restartedServices) {
          const initialPid = initialPids.get(service.name);
          if (service.name === "android") {
            expect(service.pid, `${service.name} PID`).not.toBe(initialPid);
          } else {
            expect(service.pid, `${service.name} PID`).toBe(initialPid);
          }
        }
        expect(restartedAndroidLease.owner).toMatchObject({
          serial: initialAndroidLease.owner.serial,
          token: initialAndroidLease.owner.token,
        });
        await waitForActivityTypes({
          apiUrl,
          cellId,
          types: ["service.restart"],
          timeoutMs: 30_000,
          errorMessage: "Service restart activity was not recorded",
        });

        const secondViewer = await resolveAndroidViewer(page);
        expect(secondViewer.frame).not.toBe(firstViewer.frame);
        expect(await secondViewer.iframe.getAttribute("src")).toBe(
          firstViewerUrl
        );
        const afterCapture = await captureGuestAudio({
          artifactsDir,
          emulatorOutputCapturePath,
          frame: secondViewer.frame,
          hostPlaybackCapturePath: restartedPwCat?.pcmPath,
          label: "after-restart",
          page,
          outputSpeechSource,
          videoStartedAt,
        });
        assertPcmMetrics(afterCapture.microphoneMetrics, "guest microphone");
        assertPcmMetrics(
          afterCapture.outputMetrics,
          "rendered emulator output"
        );
        assertHostPlaybackMetrics(
          afterCapture.hostPlaybackMetrics,
          "restarted host pw-cat playback"
        );

        const audioVideoMetadata = {
          segments: [beforeCapture.videoSegment, afterCapture.videoSegment],
        } satisfies AndroidAudioVideoMetadata;
        await writeFile(
          join(artifactsDir, androidAudioVideoMetadataFilename),
          JSON.stringify(audioVideoMetadata, null, 2)
        );

        await testInfo.attach("android-audio-metrics", {
          body: Buffer.from(
            JSON.stringify({ beforeCapture, afterCapture }, null, 2)
          ),
          contentType: "application/json",
        });
        await testInfo.attach("android-viewer-after-restart", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        const deleteResponse = await fetch(`${apiUrl}/api/cells/${cellId}`, {
          method: "DELETE",
        });
        expect(deleteResponse.ok, "Android E2E cell cleanup").toBe(true);
        cellIds.delete(cellId);
        await stopHostPlaybackProbe(pwCatEventsPath, restartedPwCat);
        cellId = null;
      },
      () =>
        cleanupAndroidE2eToBaseline({
          apiUrl,
          hostState,
          initialCellIds,
          workspaceId,
        })
    );
  });
});

async function readWorkspaceBaseline(apiUrl: string) {
  const workspaces = await fetchWorkspaces(apiUrl);
  const workspaceId =
    workspaces.activeWorkspaceId ?? workspaces.workspaces[0]?.id;
  if (!workspaceId) {
    throw new Error("No workspace available for Android E2E.");
  }
  const initialCellIds = new Set(
    (await fetchWorkspaceCells(apiUrl, workspaceId)).map((cell) => cell.id)
  );
  return { initialCellIds, workspaceId };
}

function readAndroidDevicesOutput() {
  const result = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr || "adb devices failed"
    );
  }
  return result.stdout;
}

const readAttachedAndroidSerials = () =>
  parseAttachedAndroidDevices(readAndroidDevicesOutput());

const parseAttachedAndroidDeviceStates = (output: string) =>
  output
    .split(ADB_DEVICE_LINE_BREAK_PATTERN)
    .slice(1)
    .map((line) => line.trim().split(WHITESPACE_PATTERN).slice(0, 2).join("\t"))
    .filter(Boolean)
    .sort();

const readAttachedAndroidDeviceStates = () =>
  parseAttachedAndroidDeviceStates(readAndroidDevicesOutput());

function prepareAndroidE2eHostState() {
  const androidDevicesOutput = readAndroidDevicesOutput();
  const preexistingSerials = parseAttachedAndroidDevices(androidDevicesOutput);
  const preexistingEmulators = new Map(
    preexistingSerials
      .filter((serial) => serial.startsWith("emulator-"))
      .map((serial) => [
        serial,
        getRunningAndroidAvdName("adb", serial, process.env),
      ])
  );
  const inheritedAndroidSerial = process.env.ANDROID_SERIAL;
  process.env.ANDROID_SERIAL = undefined;
  return {
    cellIds: new Set<string>(),
    inheritedAndroidSerial,
    ownedSerials: new Set<string>(),
    preexistingDeviceStates:
      parseAttachedAndroidDeviceStates(androidDevicesOutput),
    preexistingEmulators,
    preexistingSerials,
    recorderSerials: new Set<string>(),
  };
}

type AndroidE2eHostState = ReturnType<typeof prepareAndroidE2eHostState>;

async function runWithGuaranteedCleanup(
  run: () => Promise<void>,
  cleanup: () => Promise<void>
) {
  let runError: unknown;
  let cleanupError: unknown;
  try {
    await run();
  } catch (error) {
    runError = error;
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }
  throwRunAndCleanupErrors(
    runError,
    cleanupError,
    "Android E2E failed and cleanup did not complete."
  );
}

async function runConcurrentAndroidIsolation(options: {
  apiUrl: string;
  hostState: AndroidE2eHostState;
  workspaceId: string;
}) {
  const cellTimestamp = Date.now();
  const cellCreationResults = await Promise.allSettled([
    createCellViaApi({
      apiUrl: options.apiUrl,
      name: `Android Concurrent A ${cellTimestamp}`,
      templateLabel: ANDROID_TEMPLATE_LABEL,
      workspaceId: options.workspaceId,
    }),
    createCellViaApi({
      apiUrl: options.apiUrl,
      name: `Android Concurrent B ${cellTimestamp}`,
      templateLabel: ANDROID_TEMPLATE_LABEL,
      workspaceId: options.workspaceId,
    }),
  ]);
  for (const result of cellCreationResults) {
    if (result.status === "fulfilled") {
      options.hostState.cellIds.add(result.value);
    }
  }
  const [primaryCellId, secondaryCellId] = cellCreationResults.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
  const [primaryLease, secondaryLease] = await Promise.all([
    waitForAndroidLease(primaryCellId),
    waitForAndroidLease(secondaryCellId),
  ]);
  const [primaryLeaseStat, secondaryLeaseStat] = await Promise.all([
    stat(join(primaryLease.leasePath, "token")),
    stat(join(secondaryLease.leasePath, "token")),
  ]);
  expect(
    Math.abs(primaryLeaseStat.mtimeMs - secondaryLeaseStat.mtimeMs),
    "Concurrent Android emulator lease start skew"
  ).toBeLessThan(MAX_CONCURRENT_LEASE_START_SKEW_MS);
  options.hostState.ownedSerials.add(primaryLease.owner.serial);
  options.hostState.ownedSerials.add(secondaryLease.owner.serial);
  const [primaryServices, secondaryServices] = await Promise.all([
    waitForAndroidServices(options.apiUrl, primaryCellId),
    waitForAndroidServices(options.apiUrl, secondaryCellId),
  ]);

  assertAndroidRuntimeIsolation({
    primaryLease,
    primaryServices,
    secondaryLease,
    secondaryServices,
  });
  await deleteSecondaryAndroidCell({
    apiUrl: options.apiUrl,
    cellIds: options.hostState.cellIds,
    primaryCellId,
    primaryLease,
    primaryServices,
    secondaryCellId,
    secondaryLease,
  });
}

async function cleanupAndroidE2eToBaseline(options: {
  apiUrl: string;
  hostState: AndroidE2eHostState;
  initialCellIds: Set<string>;
  workspaceId: string;
}) {
  const cleanupFailures: unknown[] = [];
  try {
    await cleanupAndroidE2e({ apiUrl: options.apiUrl, ...options.hostState });
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await cleanupWorkspaceCellsToBaseline(options);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      "Android E2E baseline cleanup failed."
    );
  }
}

async function cleanupWorkspaceCellsToBaseline(options: {
  apiUrl: string;
  hostState: AndroidE2eHostState;
  initialCellIds: Set<string>;
  workspaceId: string;
}) {
  let lastError: unknown;
  try {
    await waitForCondition({
      check: async () => {
        try {
          const currentCells = await fetchWorkspaceCells(
            options.apiUrl,
            options.workspaceId
          );
          const unexpectedCells = currentCells.filter(
            (cell) => !options.initialCellIds.has(cell.id)
          );
          if (unexpectedCells.length === 0) {
            return true;
          }
          for (const cell of unexpectedCells) {
            options.hostState.cellIds.add(cell.id);
          }
          await cleanupAndroidE2e({
            apiUrl: options.apiUrl,
            ...options.hostState,
          });
          for (const cell of unexpectedCells) {
            options.hostState.cellIds.delete(cell.id);
          }
          return false;
        } catch (error) {
          lastError = error;
          return false;
        }
      },
      errorMessage: "Android E2E cells survived cleanup",
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new AggregateError(
      lastError ? [error, lastError] : [error],
      "Could not restore the workspace cell baseline."
    );
  }
}

function assertAndroidRuntimeIsolation(options: {
  primaryLease: Awaited<ReturnType<typeof waitForAndroidLease>>;
  primaryServices: Awaited<ReturnType<typeof waitForAndroidServices>>;
  secondaryLease: Awaited<ReturnType<typeof waitForAndroidLease>>;
  secondaryServices: Awaited<ReturnType<typeof waitForAndroidServices>>;
}) {
  expect(options.primaryLease.owner.serial).not.toBe(
    options.secondaryLease.owner.serial
  );
  expect(options.primaryLease.owner.consolePort).not.toBe(
    options.secondaryLease.owner.consolePort
  );
  expect(options.primaryLease.owner.grpcPort).not.toBe(
    options.secondaryLease.owner.grpcPort
  );
  const assignedPorts = [
    ...readServicePortAssignments(options.primaryServices),
    ...readServicePortAssignments(options.secondaryServices),
  ].map((assignment) => assignment.port);
  assignedPorts.push(
    options.primaryLease.owner.consolePort,
    options.primaryLease.owner.consolePort + 1,
    options.secondaryLease.owner.consolePort,
    options.secondaryLease.owner.consolePort + 1
  );
  expect(
    new Set(assignedPorts).size,
    "Android cell service ports are fully disjoint"
  ).toBe(assignedPorts.length);
  expect(readAttachedAndroidSerials()).toEqual(
    expect.arrayContaining([
      options.primaryLease.owner.serial,
      options.secondaryLease.owner.serial,
    ])
  );
}

async function deleteSecondaryAndroidCell(options: {
  apiUrl: string;
  cellIds: Set<string>;
  primaryCellId: string;
  primaryLease: Awaited<ReturnType<typeof waitForAndroidLease>>;
  primaryServices: Awaited<ReturnType<typeof waitForAndroidServices>>;
  secondaryCellId: string;
  secondaryLease: Awaited<ReturnType<typeof waitForAndroidLease>>;
}) {
  const primaryPorts = readServicePortAssignments(options.primaryServices);
  const primaryPids = readServicePids(options.primaryServices);
  const response = await fetch(
    `${options.apiUrl}/api/cells/${options.secondaryCellId}`,
    { method: "DELETE" }
  );
  expect(response.ok, "secondary Android cell cleanup").toBe(true);
  options.cellIds.delete(options.secondaryCellId);
  await expect
    .poll(readAttachedAndroidSerials, {
      message: "Secondary Android emulator survived isolated cleanup",
      timeout: 30_000,
    })
    .not.toContain(options.secondaryLease.owner.serial);
  expect(readAttachedAndroidSerials()).toContain(
    options.primaryLease.owner.serial
  );
  expect((await waitForAndroidLease(options.primaryCellId)).owner.token).toBe(
    options.primaryLease.owner.token
  );
  await expect
    .poll(
      () =>
        getRunningAndroidAvdName(
          "adb",
          options.primaryLease.owner.serial,
          process.env
        ),
      {
        message: "Primary Android emulator changed after secondary cleanup",
        timeout: 30_000,
      }
    )
    .toBe(options.primaryLease.owner.avdName);
  const survivingServices = await waitForAndroidServices(
    options.apiUrl,
    options.primaryCellId
  );
  expect(readServicePortAssignments(survivingServices)).toEqual(primaryPorts);
  expect(readServicePids(survivingServices)).toEqual(primaryPids);
}

async function startPlaywrightVideoTimeline(page: Page) {
  if (!page.video()) {
    throw new Error("Android E2E requires Playwright video recording.");
  }
  await page.setContent(`<!doctype html>
<html>
  <body style="margin:0;display:grid;place-items:center;width:100vw;height:100vh;background:#ff00ff;color:#000;font:700 48px monospace">
    ANDROID AUDIO SYNC<br>MIC LEFT / AUDIOTRACK RIGHT
  </body>
</html>`);
  const timelineStartedAt = monotonicEpochMs();
  await page.waitForTimeout(VIDEO_SYNC_SLATE_MS);
  return timelineStartedAt;
}

const monotonicEpochMs = () => performance.timeOrigin + performance.now();

function collectRejectedResults(
  results: PromiseSettledResult<unknown>[],
  failures: unknown[]
) {
  for (const result of results) {
    if (result.status === "rejected") {
      failures.push(result.reason);
    }
  }
}

async function cleanupAndroidRecorders(serials: Set<string>) {
  const failures: unknown[] = [];
  for (const serial of serials) {
    try {
      if (!readAttachedAndroidSerials().includes(serial)) {
        continue;
      }
      process.env.ANDROID_SERIAL = serial;
      const packagePath = await adb(
        "shell",
        "pm",
        "path",
        audioRecorderPackageName
      );
      if (!packagePath.trim()) {
        continue;
      }
      await adb("shell", "am", "force-stop", audioRecorderPackageName);
      await adb("uninstall", audioRecorderPackageName);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Android recorder cleanup failed.");
  }
}

async function cleanupAndroidE2e(options: {
  apiUrl: string;
  cellIds: Set<string>;
  inheritedAndroidSerial: string | undefined;
  ownedSerials: Set<string>;
  preexistingDeviceStates: string[];
  preexistingEmulators: Map<string, string>;
  preexistingSerials: string[];
  recorderSerials: Set<string>;
}) {
  const {
    apiUrl,
    cellIds,
    inheritedAndroidSerial,
    ownedSerials,
    preexistingDeviceStates,
    preexistingEmulators,
    recorderSerials,
  } = options;
  const cleanupFailures: unknown[] = [];
  try {
    const leaseResults = await Promise.allSettled(
      [...cellIds].map((cellId) => readAndroidRuntimeLeaseForCell(cellId))
    );
    collectRejectedResults(leaseResults, cleanupFailures);
    for (const result of leaseResults) {
      if (result.status === "fulfilled" && result.value) {
        ownedSerials.add(result.value.owner.serial);
      }
    }
    try {
      await cleanupAndroidRecorders(recorderSerials);
    } catch (error) {
      cleanupFailures.push(error);
    }
    const deletionResults = await Promise.allSettled(
      [...cellIds].map(async (pendingCellId) => {
        const response = await fetch(`${apiUrl}/api/cells/${pendingCellId}`, {
          method: "DELETE",
        });
        if (!(response.ok || response.status === HTTP_NOT_FOUND)) {
          throw new Error(
            `Failed to delete Android E2E cell ${pendingCellId}: ${response.status}`
          );
        }
        return pendingCellId;
      })
    );
    for (const result of deletionResults) {
      if (result.status === "fulfilled") {
        cellIds.delete(result.value);
      }
    }
    collectRejectedResults(deletionResults, cleanupFailures);
    const verificationResults = await Promise.allSettled([
      expect
        .poll(readAttachedAndroidDeviceStates, {
          message: "Preexisting Android devices changed during E2E cleanup",
          timeout: 30_000,
        })
        .toEqual(preexistingDeviceStates),
      ...[...ownedSerials].map((serial) =>
        expect
          .poll(readAttachedAndroidSerials, {
            message: `Android E2E emulator ${serial} survived cleanup`,
            timeout: 30_000,
          })
          .not.toContain(serial)
      ),
      ...[...preexistingEmulators].map(([serial, avdName]) =>
        expect
          .poll(() => getRunningAndroidAvdName("adb", serial, process.env), {
            message: `Preexisting Android emulator ${serial} changed identity`,
            timeout: 30_000,
          })
          .toBe(avdName)
      ),
    ]);
    collectRejectedResults(verificationResults, cleanupFailures);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, "Android E2E cleanup failed.");
    }
  } finally {
    process.env.ANDROID_SERIAL = inheritedAndroidSerial;
  }
}

async function waitForAndroidLease(cellId: string) {
  await waitForCondition({
    check: async () => Boolean(await readAndroidRuntimeLeaseForCell(cellId)),
    errorMessage: `Android emulator lease was not created for cell ${cellId}`,
    timeoutMs: SERVICE_READY_TIMEOUT_MS,
  });
  const lease = await readAndroidRuntimeLeaseForCell(cellId);
  if (!lease) {
    throw new Error(`Android emulator lease disappeared for cell ${cellId}`);
  }
  return lease;
}

async function installRecorder(recorderApk: string, outputSpeechPath: string) {
  await adb("install", "-r", recorderApk);
  await adb(
    "shell",
    "pm",
    "grant",
    audioRecorderPackageName,
    "android.permission.RECORD_AUDIO"
  );
  await adb(
    "shell",
    "mkdir",
    "-p",
    guestPlaybackSourcePath.slice(0, guestPlaybackSourcePath.lastIndexOf("/"))
  );
  await adb("push", outputSpeechPath, guestPlaybackSourcePath);
}

async function selectFakeAudioInput(page: Page) {
  const label = await page.evaluate(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find(
      (device) => device.kind === "audioinput" && device.label
    )?.label;
  });
  if (!label) {
    throw new Error(
      "Playwright fake microphone did not expose a device label."
    );
  }
  await page.evaluate((preferredLabel) => {
    localStorage.setItem("hive.audio-input.v1", JSON.stringify(preferredLabel));
  }, label);
  return label;
}

async function resolveAndroidViewer(page: Page) {
  const tab = page.getByTestId("viewer-service-tab-android");
  await tab.click();
  const iframe = page.getByTestId("web-iframe-preview");
  await expect(iframe).toBeVisible({ timeout: SERVICE_READY_TIMEOUT_MS });
  await expect(iframe).toHaveAttribute("allow", "autoplay; microphone");
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) {
    throw new Error("Android viewer iframe did not expose a content frame.");
  }
  await frame.waitForLoadState("domcontentloaded");
  return { frame, iframe };
}

async function endFallbackMicrophoneTrack(page: Page, frame: Frame) {
  await frame.evaluate(() => {
    const track = (
      window as Window & { hiveMicrophoneTrack?: MediaStreamTrack }
    ).hiveMicrophoneTrack;
    if (!track) {
      throw new Error(
        "AudioContext fallback microphone track was not captured."
      );
    }
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByTestId("viewer-microphone-error")).toContainText(
    "Selected microphone track ended."
  );
}

async function captureGuestAudio(options: {
  artifactsDir: string;
  emulatorOutputCapturePath: string;
  frame: Frame;
  hostPlaybackCapturePath?: string;
  label: string;
  onMicrophoneCaptured?: () => Promise<void>;
  outputSpeechSource: Buffer;
  page: Page;
  videoStartedAt: number;
}) {
  const {
    artifactsDir,
    emulatorOutputCapturePath,
    frame,
    hostPlaybackCapturePath,
    label,
    onMicrophoneCaptured,
    outputSpeechSource,
    page,
    videoStartedAt,
  } = options;
  const microphonePcm = `android-audio-${label}.pcm`;
  const acceptedOutputPcm = `android-output-accepted-${label}.pcm`;
  const outputPcm = `android-output-${label}.pcm`;
  const microphonePath = join(artifactsDir, microphonePcm);
  const acceptedOutputPath = join(artifactsDir, acceptedOutputPcm);
  const outputPath = join(artifactsDir, outputPcm);
  await adb(
    "shell",
    "rm",
    "-f",
    guestRecordingPath,
    guestPlaybackPath,
    guestPlaybackStartedPath,
    guestPlaybackCompletePath
  );
  await frame.evaluate(() => {
    Object.assign(window, { hiveMicrophoneFrames: 0 });
  });
  const captureStartedAt = monotonicEpochMs();
  let captureWindowMs = 0;
  let microphoneLiveAt = 0;
  let outputCaptureStartedAt = 0;
  let playbackCompleted = false;
  let outputCaptureStartBytes = 0;
  let hostPlaybackStartBytes = 0;
  try {
    await adb(
      "shell",
      "am",
      "start",
      "-n",
      `${audioRecorderPackageName}/.MainActivity`
    );
    await waitForRecorder();
    await expect
      .poll(
        () =>
          frame.evaluate(
            () =>
              (window as Window & { hiveMicrophoneFrames?: number })
                .hiveMicrophoneFrames ?? 0
          ),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);
    microphoneLiveAt = monotonicEpochMs();
    await page.waitForTimeout(SPEECH_CAPTURE_DURATION_MS);
    captureWindowMs = monotonicEpochMs() - captureStartedAt;
    await onMicrophoneCaptured?.();
    outputCaptureStartBytes = await fileSize(emulatorOutputCapturePath);
    hostPlaybackStartBytes = hostPlaybackCapturePath
      ? await fileSize(hostPlaybackCapturePath)
      : 0;
    outputCaptureStartedAt = monotonicEpochMs();
    await adb(
      "shell",
      "am",
      "start",
      "-a",
      "com.hiverun.audioe2e.PLAYBACK",
      "-n",
      `${audioRecorderPackageName}/.MainActivity`
    );
    await waitForGuestFile(
      guestPlaybackStartedPath,
      "Android AudioTrack playback did not start",
      PLAYBACK_STARTED_POLL_INTERVAL_MS
    );
    await waitForPlaybackComplete();
    playbackCompleted = true;
  } finally {
    if (!playbackCompleted) {
      await adb("shell", "am", "force-stop", audioRecorderPackageName).catch(
        () => {
          // Capture startup may have failed before the guest activity launched.
        }
      );
    }
    captureWindowMs ||= monotonicEpochMs() - captureStartedAt;
    await page.waitForTimeout(CAPTURE_FLUSH_WAIT_MS);
  }
  const captureFinishedAt = monotonicEpochMs();
  await adb("pull", guestRecordingPath, microphonePath);
  await adb("pull", guestPlaybackPath, acceptedOutputPath);
  const outputPcmBuffer = await waitForEmulatorOutput({
    capturePath: emulatorOutputCapturePath,
    startBytes: outputCaptureStartBytes,
  });
  const hostPlaybackPcmBuffer = hostPlaybackCapturePath
    ? await waitForEmulatorOutput({
        capturePath: hostPlaybackCapturePath,
        startBytes: hostPlaybackStartBytes,
      })
    : null;
  await writeFile(outputPath, outputPcmBuffer);
  const microphonePcmBuffer = await readFile(microphonePath);
  const acceptedOutputBuffer = await readFile(acceptedOutputPath);
  const outputSourceDigest = pcmDigest(outputSpeechSource);
  const acceptedOutputDigest = pcmDigest(acceptedOutputBuffer);
  const outputDigest = pcmDigest(outputPcmBuffer);
  const microphoneDigest = pcmDigest(microphonePcmBuffer);
  expect(
    acceptedOutputDigest,
    "AudioTrack accepted the complete output speech fixture"
  ).toBe(outputSourceDigest);
  expect(
    microphoneDigest,
    "microphone input and AudioTrack output use distinct speech"
  ).not.toBe(outputDigest);
  const microphoneMetrics = {
    ...analyzePcm(
      microphonePcmBuffer,
      microphoneSpeechPilotFrequency,
      SPEECH_ACTIVE_RMS
    ),
    alternatePilotRatio: analyzePcm(
      microphonePcmBuffer,
      outputSpeechPilotFrequency,
      SPEECH_ACTIVE_RMS
    ).toneRatio,
    captureWindowMs,
    maximumSpanMs:
      SPEECH_CAPTURE_DURATION_MS + AUDIO_SPAN_TOLERANCE_MS + MAXIMUM_DROPOUT_MS,
  };
  const outputMetrics = {
    ...analyzePcm(
      outputPcmBuffer,
      outputSpeechPilotFrequency,
      SPEECH_ACTIVE_RMS
    ),
    alternatePilotRatio: analyzePcm(
      outputPcmBuffer,
      microphoneSpeechPilotFrequency,
      SPEECH_ACTIVE_RMS
    ).toneRatio,
    captureWindowMs,
    maximumSpanMs:
      (outputSpeechSource.length /
        PCM_BYTES_PER_SAMPLE /
        androidAudioSampleRate) *
        MILLISECONDS_PER_SECOND +
      AUDIO_SPAN_TOLERANCE_MS,
  };
  const hostPlaybackMetrics = hostPlaybackPcmBuffer
    ? {
        ...analyzePcm(
          hostPlaybackPcmBuffer,
          outputSpeechPilotFrequency,
          SPEECH_ACTIVE_RMS
        ),
        alternatePilotRatio: analyzePcm(
          hostPlaybackPcmBuffer,
          microphoneSpeechPilotFrequency,
          SPEECH_ACTIVE_RMS
        ).toneRatio,
        captureWindowMs,
        maximumSpanMs:
          (outputSpeechSource.length /
            PCM_BYTES_PER_SAMPLE /
            androidAudioSampleRate) *
            MILLISECONDS_PER_SECOND +
          AUDIO_SPAN_TOLERANCE_MS,
      }
    : null;
  const microphoneOffsetMs = Math.max(
    0,
    Math.round(
      microphoneLiveAt - videoStartedAt - microphoneMetrics.firstActiveMs
    )
  );
  const outputOffsetMs = Math.max(
    0,
    Math.round(outputCaptureStartedAt - videoStartedAt)
  );
  return {
    acceptedOutputDigest,
    microphoneDigest,
    microphoneMetrics,
    hostPlaybackMetrics,
    outputDigest,
    outputMetrics,
    videoSegment: {
      label:
        label === "before-restart"
          ? "BEFORE SERVICE RESTART"
          : "AFTER SERVICE RESTART",
      microphonePcm,
      microphoneActiveDurationMs: microphoneMetrics.activeSpanMs,
      microphoneActiveOffsetMs:
        microphoneOffsetMs + microphoneMetrics.firstActiveMs,
      microphoneOffsetMs,
      outputPcm,
      outputActiveDurationMs: outputMetrics.activeSpanMs,
      outputActiveOffsetMs: outputOffsetMs + outputMetrics.firstActiveMs,
      outputOffsetMs,
      videoEndMs: Math.max(0, Math.round(captureFinishedAt - videoStartedAt)),
      videoStartMs: Math.max(
        0,
        Math.round(captureStartedAt - videoStartedAt - EVIDENCE_LEAD_IN_MS)
      ),
    },
  };
}

async function readPwCatEvents(path: string): Promise<PwCatEvent[]> {
  const contents = await readFile(path, "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PwCatEvent);
}

async function startHostPlaybackProbe(path: string) {
  if (process.platform !== "linux") {
    return null;
  }
  const event = await waitForPwCatStart(path);
  expect(isProcessAlive(event.pid)).toBe(true);
  return event;
}

async function restartHostPlaybackProbe(
  path: string,
  previous: PwCatEvent | null
) {
  if (!previous) {
    return null;
  }
  const event = await waitForPwCatStart(path, previous.pid);
  expect(event.pid).not.toBe(previous.pid);
  expect(isProcessAlive(event.pid)).toBe(true);
  return event;
}

async function stopHostPlaybackProbe(path: string, event: PwCatEvent | null) {
  if (event) {
    await waitForPwCatExit(path, event.pid);
  }
}

function assertHostPlaybackMetrics(
  metrics:
    | (ReturnType<typeof analyzePcm> & {
        alternatePilotRatio: number;
        captureWindowMs: number;
        maximumSpanMs: number;
      })
    | null,
  label: string
) {
  if (process.platform === "linux") {
    if (!metrics) {
      throw new Error(`${label} metrics were not captured`);
    }
    assertPcmMetrics(metrics, label);
  }
}

async function waitForPwCatStart(path: string, previousPid?: number) {
  let event: PwCatEvent | undefined;
  await waitForCondition({
    check: async () => {
      event = (await readPwCatEvents(path)).find(
        (candidate) =>
          candidate.event === "start" && candidate.pid !== previousPid
      );
      return Boolean(event && isProcessAlive(event.pid));
    },
    errorMessage: "pw-cat playback process did not start",
    intervalMs: PLAYBACK_STARTED_POLL_INTERVAL_MS,
    timeoutMs: PLAYBACK_READY_TIMEOUT_MS,
  });
  if (!event) {
    throw new Error("pw-cat playback start event was not recorded");
  }
  return event;
}

async function waitForPwCatExit(path: string, pid: number) {
  await waitForCondition({
    check: async () =>
      (await readPwCatEvents(path)).some(
        (event) => event.event === "exit" && event.pid === pid
      ) && !isProcessAlive(pid),
    errorMessage: `pw-cat playback process ${pid} survived service cleanup`,
    intervalMs: PLAYBACK_STARTED_POLL_INTERVAL_MS,
    timeoutMs: PLAYBACK_READY_TIMEOUT_MS,
  });
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const pcmDigest = (pcm: Buffer) =>
  createHash("sha256").update(pcm).digest("hex");

async function waitForPlaybackComplete() {
  await waitForGuestFile(
    guestPlaybackCompletePath,
    "Android AudioTrack playback did not complete"
  );
}

async function fileSize(path: string) {
  return await stat(path)
    .then((details) => details.size)
    .catch(() => 0);
}

async function waitForEmulatorOutput(options: {
  capturePath: string;
  startBytes: number;
}) {
  let latest = Buffer.alloc(0);
  await waitForCondition({
    check: async () => {
      const stereo = await readFile(options.capturePath).catch(() =>
        Buffer.alloc(0)
      );
      const alignedStart =
        Math.floor(options.startBytes / STEREO_FRAME_BYTES) *
        STEREO_FRAME_BYTES;
      latest = stereoPcmToMono(stereo.subarray(alignedStart));
      if (latest.length < androidAudioSampleRate * PCM_BYTES_PER_SAMPLE) {
        return false;
      }
      const metrics = analyzePcm(
        latest,
        outputSpeechPilotFrequency,
        SPEECH_ACTIVE_RMS
      );
      const alternatePilotRatio = analyzePcm(
        latest,
        microphoneSpeechPilotFrequency,
        SPEECH_ACTIVE_RMS
      ).toneRatio;
      return (
        metrics.activeDurationMs >= MINIMUM_ACTIVE_DURATION_MS &&
        metrics.toneRatio >= MINIMUM_PILOT_RATIO &&
        metrics.toneRatio >= alternatePilotRatio * MINIMUM_PILOT_SEPARATION
      );
    },
    errorMessage: "Emulator gRPC output did not contain the coaching response",
    intervalMs: PLAYBACK_STARTED_POLL_INTERVAL_MS,
    timeoutMs: PLAYBACK_READY_TIMEOUT_MS,
  });
  return latest;
}

function stereoPcmToMono(stereo: Buffer) {
  const frameCount = Math.floor(stereo.length / STEREO_FRAME_BYTES);
  const mono = Buffer.alloc(frameCount * PCM_BYTES_PER_SAMPLE);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * STEREO_FRAME_BYTES;
    const sample = Math.round(
      (stereo.readInt16LE(offset) +
        stereo.readInt16LE(offset + PCM_BYTES_PER_SAMPLE)) /
        2
    );
    mono.writeInt16LE(sample, frame * PCM_BYTES_PER_SAMPLE);
  }
  return mono;
}

async function waitForGuestFile(
  path: string,
  errorMessage: string,
  intervalMs?: number
) {
  await waitForCondition({
    check: () =>
      adb("shell", "test", "-f", path)
        .then(() => true)
        .catch(() => false),
    errorMessage,
    intervalMs,
    timeoutMs: PLAYBACK_READY_TIMEOUT_MS,
  });
}

function assertPcmMetrics(
  metrics: ReturnType<typeof analyzePcm> & {
    alternatePilotRatio: number;
    captureWindowMs: number;
    maximumSpanMs: number;
  },
  label: string
) {
  expect(metrics.rms, `${label} RMS`).toBeGreaterThanOrEqual(MINIMUM_RMS);
  expect(
    metrics.toneRatio,
    `${label} speech pilot ratio`
  ).toBeGreaterThanOrEqual(MINIMUM_PILOT_RATIO);
  expect(
    metrics.toneRatio,
    `${label} uses its distinct speech pilot`
  ).toBeGreaterThanOrEqual(
    metrics.alternatePilotRatio * MINIMUM_PILOT_SEPARATION
  );
  expect(
    metrics.activeDurationMs,
    `${label} active audio duration`
  ).toBeGreaterThanOrEqual(MINIMUM_ACTIVE_DURATION_MS);
  expect(
    metrics.activeSpanMs,
    `${label} queued audio span`
  ).toBeLessThanOrEqual(metrics.maximumSpanMs);
  expect(
    metrics.longestDropoutMs,
    `${label} longest audio dropout`
  ).toBeLessThanOrEqual(MAXIMUM_DROPOUT_MS);
}

async function waitForAndroidServices(apiUrl: string, cellId: string) {
  return await waitForServiceStatuses({
    apiUrl,
    cellId,
    timeoutMs: SERVICE_READY_TIMEOUT_MS,
    errorMessage: "Android services did not become ready",
    predicate: (services) =>
      services.length === SERVICE_COUNT &&
      services.every(
        (service) =>
          service.status.toLowerCase() === "running" &&
          typeof service.pid === "number" &&
          service.ports.every((port) => port.portReachable)
      ),
  });
}

function readServicePids(
  services: Awaited<ReturnType<typeof waitForAndroidServices>>
) {
  return new Map(services.map((service) => [service.name, service.pid]));
}

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Android service audio E2E.`);
  }
  return value;
}
