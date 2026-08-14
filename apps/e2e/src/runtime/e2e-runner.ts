import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { prepareAndroidAudioVideoMux } from "../../../../packages/android-runtime/e2e/audio-video";
import {
  analyzePcm,
  androidAudioSampleRate,
  microphoneSpeechPilotFrequency,
  outputSpeechPilotFrequency,
} from "../../../../packages/android-runtime/e2e/browser-microphone";
import { finishRuntimeRun } from "./artifacts";
import { createFixtureWorkspace } from "./fixture-workspace";
import { parseSpecArg, resolveRuntimePaths } from "./paths";
import { runPlaywrightSuite } from "./playwright";
import {
  createManagedProcessStopper,
  type ManagedProcess,
  readProcessTable,
  runCommand,
  runCommandCapture,
  startManagedProcess,
  stopManagedProcesses,
  terminateProcessIds,
} from "./process";
import { createRuntimeContext, type RuntimeContext } from "./runtime-context";
import { startCompiledWebE2eServer, startWebE2eServer } from "./server";
import { waitForHttpOk } from "./wait";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const ANDROID_E2E = process.env.HIVE_E2E_ANDROID === "1";
const DEFAULT_CLEANUP_TIMEOUT_MS = 15_000;
const ANDROID_CLEANUP_TIMEOUT_MS = 90_000;
const BROWSER_SPEECH_DURATION_SECONDS = 8;
const ANDROID_OUTPUT_SPEECH_DURATION_SECONDS = 6;
const MICROPHONE_SPEECH =
  "Calibrate interview response. I led a difficult project, resolved the main risk, and delivered a measurable result.";
const OUTPUT_SPEECH =
  "Calibrate coaching prompt. Explain the decision you made and how you measured the result.";
const AUDIO_CHANNEL_COUNT = 2;
const MINIMUM_ENCODED_ACTIVE_AUDIO_MS = 4000;
const MINIMUM_ENCODED_PILOT_RATIO = 0.015;
const MINIMUM_ENCODED_PILOT_SEPARATION = 1.4;
const ENCODED_AUDIO_ACTIVE_RMS = 0.01;
const PCM_BYTES_PER_SAMPLE = 2;
const MAXIMUM_VIDEO_DURATION_DRIFT_SECONDS = 0.5;
const MILLISECONDS_PER_SECOND = 1000;
const CLEANUP_TIMEOUT_MS = ANDROID_E2E
  ? ANDROID_CLEANUP_TIMEOUT_MS
  : DEFAULT_CLEANUP_TIMEOUT_MS;
const STARTUP_TIMEOUT_MS = 180_000;
const OPENCODE_TERMINATE_WAIT_MS = 1000;
const WEB_READY_PATH = "/";
const SECONDARY_WORKSPACE_NAME = "workspace-secondary";
const ANDROID_BUILD_FINGERPRINT_FILENAME = ".hive-e2e-build-fingerprint";
const ANDROID_BUILD_PATHS = [
  "apps/server",
  "apps/web",
  "apps/desktop-electron",
  "packages/android-runtime",
  "packages/cli",
  "packages/daemon-runtime",
  "patches",
  "scripts",
  "package.json",
  "bun.lock",
  "tsconfig.base.json",
  "tsconfig.json",
  "turbo.json",
] as const;

type WorkspaceMode = "fixture" | "clone";

const WORKSPACE_MODE_ENV = "HIVE_E2E_WORKSPACE_MODE";
const WORKSPACE_SOURCE_ENV = "HIVE_E2E_WORKSPACE_SOURCE";
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "fixture";

const { e2eRoot, repoRoot, serverRoot, stableArtifactsDir } =
  resolveRuntimePaths(import.meta.url);
const webRoot = join(repoRoot, "apps", "web");
const e2eRunsRoot = join(repoRoot, "tmp", "e2e-runs");
const useSharedHiveHome = process.env.HIVE_E2E_SHARED_HOME === "1";
const sharedHiveHomePath = join(repoRoot, "tmp", "e2e-shared", "hive-home");
const stopManagedProcess = createManagedProcessStopper({
  cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
  warnOnMissingLogs: true,
});
const phaseTimings: Array<{ durationMs: number; phase: string }> = [];

async function measurePhase<T>(phase: string, operation: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const durationMs = Math.round(performance.now() - startedAt);
    phaseTimings.push({ durationMs, phase });
    process.stdout.write(`E2E phase ${phase}: ${durationMs}ms\n`);
  }
}

async function run() {
  const spec = parseSpecArg(process.argv.slice(2));
  const workspaceMode = resolveWorkspaceMode();
  if (ANDROID_E2E && workspaceMode !== "fixture") {
    throw new Error(
      "Android service audio E2E requires fixture workspace mode."
    );
  }
  const workspaceRootName = workspaceMode === "clone" ? "hive" : "workspace";
  const context = await createRuntimeContext({
    hiveHomePath: useSharedHiveHome ? sharedHiveHomePath : undefined,
    repoRoot,
    workspaceName: workspaceRootName,
  });
  const secondaryWorkspaceRoot = join(
    context.runRoot,
    SECONDARY_WORKSPACE_NAME
  );
  const managedProcesses: ManagedProcess[] = [];
  let runSucceeded = false;

  try {
    await cleanupOrphanedOpencodeProcesses({
      currentPid: process.pid,
      e2eRunsRoot,
      preserveRunRoot: context.runRoot,
    });

    if (useSharedHiveHome) {
      process.stdout.write(`Using shared E2E HIVE_HOME: ${context.hiveHome}\n`);
    }

    await measurePhase("workspace preparation", async () => {
      if (workspaceMode === "clone") {
        const workspaceSource = resolveWorkspaceSource();
        process.stdout.write(
          `Preparing cloned E2E workspace from ${workspaceSource}\n`
        );
        await createClonedWorkspace({
          sourceRoot: workspaceSource,
          workspaceRoot: context.workspaceRoot,
        });
        await createWebFixtureWorkspace(secondaryWorkspaceRoot, false);
      } else {
        await createWebFixtureWorkspace(context.workspaceRoot, ANDROID_E2E);
        await createWebFixtureWorkspace(secondaryWorkspaceRoot, false);
      }
    });

    const androidEnvironment = ANDROID_E2E
      ? await measurePhase("Android preparation", () =>
          prepareAndroidE2e(context.artifactsDir)
        )
      : null;
    const server = androidEnvironment
      ? await startCompiledWebE2eServer({
          context,
          executablePath: androidEnvironment.executablePath,
          logsDir: context.logsDir,
          releaseDirectory: androidEnvironment.releaseDirectory,
          stopProcess: stopManagedProcess,
        })
      : await startWebE2eServer({
          context,
          logsDir: context.logsDir,
          serverRoot,
          stopProcess: stopManagedProcess,
        });
    managedProcesses.push(server);

    if (!androidEnvironment) {
      const web = startManagedProcess({
        command: "bun",
        args: [
          "run",
          "dev:e2e",
          "--",
          "--host",
          "127.0.0.1",
          "--port",
          String(context.webPort),
        ],
        cwd: webRoot,
        env: {
          ...process.env,
          PORT: String(context.webPort),
          VITE_API_URL: context.apiUrl,
          VITE_DISABLE_DEVTOOLS: "true",
        },
        logsDir: context.logsDir,
        name: "web",
      });
      managedProcesses.push(web);
    }

    const browserUrl = androidEnvironment ? context.apiUrl : context.webUrl;
    if (!browserUrl) {
      throw new Error("E2E browser URL is unavailable.");
    }

    await measurePhase("server startup", () =>
      waitForHttpOk(`${browserUrl}${WEB_READY_PATH}`, {
        timeoutMs: STARTUP_TIMEOUT_MS,
      })
    );

    await measurePhase("Playwright suite", () =>
      runPlaywrightSuite({
        context,
        e2eRoot,
        extraEnv: {
          HIVE_E2E_BASE_URL: browserUrl,
          HIVE_E2E_SECOND_WORKSPACE_PATH: secondaryWorkspaceRoot,
          ...(androidEnvironment ?? {}),
        },
        label: "Playwright suite",
        spec,
      })
    );
    if (ANDROID_E2E) {
      await measurePhase("evidence mux and validation", async () => {
        const audioVideo = await prepareAndroidAudioVideoMux(
          context.artifactsDir
        );
        await runCommand("ffmpeg", audioVideo.args, {
          cwd: context.artifactsDir,
          label: "Mux Android E2E audio video",
        });
        await validateAndroidAudioVideo({
          artifactsDir: context.artifactsDir,
          expectedDurationMs: audioVideo.expectedDurationMs,
          outputPath: audioVideo.outputPath,
          segmentDurationsMs: audioVideo.segmentDurationsMs,
        });
        process.stdout.write(
          `Android E2E audio video: ${audioVideo.outputPath}\n`
        );
      });
    }

    runSucceeded = true;
    process.stdout.write("E2E suite passed.\n");
  } finally {
    await measurePhase("process cleanup", async () => {
      await stopManagedProcesses(managedProcesses, stopManagedProcess);
      await cleanupOpencodeProcessesForRunRoot(context.runRoot);
    });
    await writeFile(
      join(context.artifactsDir, "e2e-phase-timings.json"),
      JSON.stringify(phaseTimings, null, 2)
    );
    await preserveFailureRuntimeLogs({ context, runSucceeded });

    await finishRuntimeRun({
      artifactsDir: context.artifactsDir,
      keepArtifacts: KEEP_ARTIFACTS,
      reportsLabel: "E2E reports",
      runRoot: context.runRoot,
      runSucceeded,
      runArtifactsLabel: "E2E run artifacts",
      stableArtifactsDir,
    });
  }
}

async function preserveFailureRuntimeLogs(options: {
  context: RuntimeContext;
  runSucceeded: boolean;
}): Promise<void> {
  if (options.runSucceeded) {
    return;
  }
  try {
    await cp(
      options.context.logsDir,
      join(options.context.artifactsDir, "runtime-logs"),
      { recursive: true }
    );
  } catch (error) {
    process.stderr.write(
      `Failed to preserve E2E runtime logs: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

type AndroidAudioVideoProbe = {
  format?: { duration?: string };
  streams?: Array<{
    channels?: number;
    codec_name?: string;
    codec_type?: string;
    sample_rate?: string;
  }>;
};

async function validateAndroidAudioVideo(options: {
  artifactsDir: string;
  expectedDurationMs: number;
  outputPath: string;
  segmentDurationsMs: number[];
}) {
  const probe = JSON.parse(
    await runCommandCapture(
      "ffprobe",
      [
        "-v",
        "error",
        "-of",
        "json",
        "-show_entries",
        "stream=codec_name,codec_type,sample_rate,channels:format=duration",
        options.outputPath,
      ],
      { cwd: options.artifactsDir, label: "Probe Android E2E evidence video" }
    )
  ) as AndroidAudioVideoProbe;
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  const expectedDuration = options.expectedDurationMs / MILLISECONDS_PER_SECOND;
  if (
    video?.codec_name !== "h264" ||
    audio?.codec_name !== "aac" ||
    audio.channels !== AUDIO_CHANNEL_COUNT ||
    audio.sample_rate !== String(androidAudioSampleRate) ||
    !Number.isFinite(duration) ||
    Math.abs(duration - expectedDuration) > MAXIMUM_VIDEO_DURATION_DRIFT_SECONDS
  ) {
    throw new Error(
      `Android E2E evidence video validation failed: ${JSON.stringify(probe)}`
    );
  }

  const leftPath = join(options.artifactsDir, ".evidence-left.pcm");
  const rightPath = join(options.artifactsDir, ".evidence-right.pcm");
  try {
    await Promise.all([
      decodeEvidenceChannel(options.outputPath, leftPath, "c0"),
      decodeEvidenceChannel(options.outputPath, rightPath, "c1"),
    ]);
    const [left, right] = await Promise.all([
      readFile(leftPath),
      readFile(rightPath),
    ]);
    let segmentStartMs = 0;
    for (const [index, durationMs] of options.segmentDurationsMs.entries()) {
      const start = pcmByteOffset(segmentStartMs);
      const end = pcmByteOffset(segmentStartMs + durationMs);
      const leftSegment = left.subarray(start, end);
      const rightSegment = right.subarray(start, end);
      if (
        leftSegment.length !== end - start ||
        rightSegment.length !== end - start
      ) {
        throw new Error(
          `Android E2E evidence chapter ${index + 1} is truncated.`
        );
      }
      validateEncodedSpeechChannel({
        alternateFrequency: outputSpeechPilotFrequency,
        channel: leftSegment,
        label: `microphone input chapter ${index + 1}`,
        pilotFrequency: microphoneSpeechPilotFrequency,
      });
      validateEncodedSpeechChannel({
        alternateFrequency: microphoneSpeechPilotFrequency,
        channel: rightSegment,
        label: `rendered emulator output chapter ${index + 1}`,
        pilotFrequency: outputSpeechPilotFrequency,
      });
      if (leftSegment.equals(rightSegment)) {
        throw new Error(
          `Android E2E evidence audio channels are identical in chapter ${index + 1}.`
        );
      }
      segmentStartMs += durationMs;
    }
  } finally {
    await Promise.all([
      rm(leftPath, { force: true }),
      rm(rightPath, { force: true }),
    ]);
  }
}

function pcmByteOffset(milliseconds: number) {
  return (
    Math.round(
      (milliseconds * androidAudioSampleRate) / MILLISECONDS_PER_SECOND
    ) * PCM_BYTES_PER_SAMPLE
  );
}

async function decodeEvidenceChannel(
  inputPath: string,
  outputPath: string,
  channel: "c0" | "c1"
) {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      inputPath,
      "-af",
      `pan=mono|c0=${channel}`,
      "-f",
      "s16le",
      outputPath,
    ],
    { cwd: repoRoot, label: `Decode Android E2E evidence ${channel}` }
  );
}

function validateEncodedSpeechChannel(options: {
  alternateFrequency: number;
  channel: Buffer;
  label: string;
  pilotFrequency: number;
}) {
  const metrics = analyzePcm(
    options.channel,
    options.pilotFrequency,
    ENCODED_AUDIO_ACTIVE_RMS
  );
  const alternatePilotRatio = analyzePcm(
    options.channel,
    options.alternateFrequency,
    ENCODED_AUDIO_ACTIVE_RMS
  ).toneRatio;
  if (
    metrics.activeDurationMs < MINIMUM_ENCODED_ACTIVE_AUDIO_MS ||
    metrics.toneRatio < MINIMUM_ENCODED_PILOT_RATIO ||
    metrics.toneRatio < alternatePilotRatio * MINIMUM_ENCODED_PILOT_SEPARATION
  ) {
    throw new Error(
      `Encoded ${options.label} validation failed: ${JSON.stringify({ ...metrics, alternatePilotRatio })}`
    );
  }
}

async function createWebFixtureWorkspace(
  workspaceRoot: string,
  includeAndroidTemplate = false
): Promise<void> {
  await createFixtureWorkspace({
    workspaceRoot,
    readmeTitle: "Hive E2E Workspace",
    commitMessage: "Initialize E2E workspace",
    includeAndroidTemplate,
    includeServicesTemplate: true,
    includeSetupRetryTemplate: true,
  });
}

async function prepareAndroidE2e(artifactsDir: string) {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error("Android service audio E2E requires Linux or macOS.");
  }
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
    throw new Error(
      "Android service audio E2E requires ANDROID_HOME or ANDROID_SDK_ROOT."
    );
  }
  await runCommand("ffmpeg", ["-version"], {
    cwd: repoRoot,
    label: "Check Android E2E ffmpeg dependency",
  });

  const releaseDirectory = join(
    repoRoot,
    "dist",
    "install",
    `hive-${process.platform}-${process.arch}`
  );
  const executablePath = join(releaseDirectory, "hive");
  await prepareAndroidBuild({ executablePath, releaseDirectory });
  const microphoneSpeechPath = join(
    artifactsDir,
    "calibrate-microphone-input.wav"
  );
  const outputSpeechPath = join(artifactsDir, "calibrate-android-output.pcm");
  await mkdir(artifactsDir, { recursive: true });
  await measurePhase("speech fixture generation", () =>
    Promise.all([
      createSpeechFixture({
        durationSeconds: BROWSER_SPEECH_DURATION_SECONDS,
        outputPath: microphoneSpeechPath,
        outputType: "wav",
        pilotFrequency: microphoneSpeechPilotFrequency,
        text: MICROPHONE_SPEECH,
        voice: "slt",
      }),
      createSpeechFixture({
        durationSeconds: ANDROID_OUTPUT_SPEECH_DURATION_SECONDS,
        outputPath: outputSpeechPath,
        outputType: "pcm",
        pilotFrequency: outputSpeechPilotFrequency,
        text: OUTPUT_SPEECH,
        voice: "rms",
      }),
    ])
  );

  return {
    HIVE_E2E_ANDROID: "1",
    HIVE_E2E_ANDROID_OUTPUT_SPEECH_PATH: outputSpeechPath,
    HIVE_E2E_BROWSER_SPEECH_PATH: microphoneSpeechPath,
    executablePath,
    releaseDirectory,
  };
}

async function prepareAndroidBuild(options: {
  executablePath: string;
  releaseDirectory: string;
}) {
  const canReuse = !process.env.CI && process.env.HIVE_E2E_REUSE_BUILD !== "0";
  const fingerprint = canReuse ? await androidBuildFingerprint() : null;
  const markerPath = join(
    options.releaseDirectory,
    ANDROID_BUILD_FINGERPRINT_FILENAME
  );
  const cachedFingerprint = await readFile(markerPath, "utf8").catch(() => "");
  const executableExists = await access(options.executablePath)
    .then(() => true)
    .catch(() => false);
  if (fingerprint && executableExists && cachedFingerprint === fingerprint) {
    process.stdout.write("Reusing unchanged local production Hive assembly.\n");
    return;
  }

  await measurePhase("production assembly build", () =>
    runCommand("bun", ["run", "build:installer"], {
      cwd: repoRoot,
      label: "Build production Hive assembly",
      streamOutput: true,
    })
  );
  if (fingerprint) {
    await writeFile(markerPath, fingerprint);
  }
}

async function androidBuildFingerprint() {
  try {
    const [revision, diff, untrackedOutput] = await Promise.all([
      runCommandCapture("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        label: "Read Android E2E build revision",
      }),
      runCommandCapture(
        "git",
        [
          "diff",
          "--no-ext-diff",
          "--binary",
          "HEAD",
          "--",
          ...ANDROID_BUILD_PATHS,
        ],
        { cwd: repoRoot, label: "Read Android E2E build diff" }
      ),
      runCommandCapture(
        "git",
        [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          ...ANDROID_BUILD_PATHS,
        ],
        { cwd: repoRoot, label: "Read Android E2E untracked sources" }
      ),
    ]);
    const hash = createHash("sha256")
      .update(revision)
      .update(diff)
      .update(process.platform)
      .update(process.arch)
      .update(Bun.version);
    const untracked = untrackedOutput.split("\n").filter(Boolean).sort();
    for (const path of untracked) {
      hash.update(path).update(await readFile(resolvePath(repoRoot, path)));
    }
    return hash.digest("hex");
  } catch (error) {
    process.stderr.write(
      `Could not fingerprint the local production assembly; rebuilding: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return null;
  }
}

async function createSpeechFixture(options: {
  durationSeconds: number;
  outputPath: string;
  outputType: "pcm" | "wav";
  pilotFrequency: number;
  text: string;
  voice: string;
}) {
  const filter = [
    `[0:a]aresample=${androidAudioSampleRate},volume=0.7[voice]`,
    "[1:a]volume=0.02[pilot]",
    `[voice][pilot]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.8,atrim=duration=${options.durationSeconds}[audio]`,
  ].join(";");
  const outputArgs =
    options.outputType === "wav" ? ["-c:a", "pcm_s16le"] : ["-f", "s16le"];
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `flite=voice=${options.voice}:text='${options.text}'`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${options.pilotFrequency}:sample_rate=${androidAudioSampleRate}:duration=${options.durationSeconds}`,
      "-filter_complex",
      filter,
      "-map",
      "[audio]",
      "-ar",
      String(androidAudioSampleRate),
      "-ac",
      "1",
      ...outputArgs,
      options.outputPath,
    ],
    {
      cwd: artifactsDirFor(options.outputPath),
      label: `Generate ${options.outputType} speech fixture`,
    }
  );
}

const artifactsDirFor = (outputPath: string) => resolvePath(outputPath, "..");

async function cleanupOrphanedOpencodeProcesses(options: {
  currentPid: number;
  e2eRunsRoot: string;
  preserveRunRoot: string;
}): Promise<void> {
  const processTable = readProcessTable();
  const concurrentRunnerPids = processTable
    .filter(
      (entry) =>
        entry.pid !== options.currentPid &&
        entry.args.includes("src/runtime/e2e-runner.ts")
    )
    .map((entry) => entry.pid);

  if (concurrentRunnerPids.length > 0) {
    process.stdout.write(
      `Skipping stale opencode cleanup while other e2e runners are active: ${concurrentRunnerPids.join(", ")}\n`
    );
    return;
  }

  const orphanedPids = processTable
    .filter(
      (entry) =>
        entry.args.includes("opencode") &&
        entry.args.includes(options.e2eRunsRoot) &&
        !entry.args.includes(options.preserveRunRoot)
    )
    .map((entry) => entry.pid);

  const terminated = await terminateProcessIds(orphanedPids, {
    terminateWaitMs: OPENCODE_TERMINATE_WAIT_MS,
  });
  if (terminated > 0) {
    process.stdout.write(
      `Cleaned ${String(terminated)} stale opencode process(es) from previous e2e runs\n`
    );
  }
}

async function cleanupOpencodeProcessesForRunRoot(
  runRoot: string
): Promise<void> {
  const runRootPids = readProcessTable()
    .filter(
      (entry) => entry.args.includes("opencode") && entry.args.includes(runRoot)
    )
    .map((entry) => entry.pid);

  const terminated = await terminateProcessIds(runRootPids, {
    terminateWaitMs: OPENCODE_TERMINATE_WAIT_MS,
  });
  if (terminated > 0) {
    process.stdout.write(
      `Cleaned ${String(terminated)} opencode process(es) for run ${runRoot}\n`
    );
  }
}

async function createClonedWorkspace(options: {
  sourceRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  await rm(options.workspaceRoot, { recursive: true, force: true });

  const branch = await resolveSourceBranch(options.sourceRoot);
  const cloneArgs = [
    "clone",
    "--no-hardlinks",
    ...(branch ? ["--branch", branch, "--single-branch"] : []),
    options.sourceRoot,
    options.workspaceRoot,
  ];

  await runCommand("git", cloneArgs, {
    cwd: repoRoot,
    label: "Clone fixture workspace",
  });
}

async function resolveSourceBranch(sourceRoot: string): Promise<string | null> {
  try {
    const branch = await runCommandCapture(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: sourceRoot,
        label: "Resolve source workspace branch",
      }
    );

    if (!branch || branch === "HEAD") {
      return null;
    }

    return branch;
  } catch {
    return null;
  }
}

function resolveWorkspaceMode(): WorkspaceMode {
  const configured = process.env[WORKSPACE_MODE_ENV]?.trim().toLowerCase();
  if (!configured) {
    return DEFAULT_WORKSPACE_MODE;
  }

  if (configured === "fixture" || configured === "clone") {
    return configured;
  }

  throw new Error(
    `${WORKSPACE_MODE_ENV} must be either 'fixture' or 'clone' (received '${configured}')`
  );
}

function resolveWorkspaceSource(): string {
  const configured = process.env[WORKSPACE_SOURCE_ENV]?.trim();
  if (!configured) {
    return repoRoot;
  }

  return resolvePath(configured);
}

run().catch((error) => {
  process.stderr.write(
    `E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
