#!/usr/bin/env bun

// biome-ignore-all lint/style/noMagicNumbers: Android build formats and audio acceptance thresholds are fixed protocol values.
// biome-ignore-all lint/suspicious/noConsole: This standalone E2E script reports progress and verification evidence.

import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { microphoneCaptureIsRunning } from "stream-droid/src/wsServer.ts";

import { terminateChild, waitForChildExit } from "../src/process";

const packageName = "com.hiverun.audioe2e";
const sampleRate = 48_000;
const toneFrequency = 997;
const audioFrameMilliseconds = 20;
const recordingPath = `/sdcard/Android/data/${packageName}/files/capture.pcm`;
const androidHome =
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "";
const serial = process.env.ANDROID_SERIAL ?? "";
const packageRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(packageRoot, "../..");

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

const run = async (
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 120_000);
    const finish = (operation: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      operation();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      if (code === 0) {
        finish(() => resolve(stdout));
      } else {
        finish(() =>
          reject(
            new Error(
              timedOut
                ? `${command} ${args.join(" ")} timed out.`
                : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr || stdout}`
            )
          )
        );
      }
    });
  });

const adb = (...args: string[]): Promise<string> =>
  run("adb", ["-s", serial, ...args]);

const reservePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a viewer port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const createToneWav = (seconds: number): Buffer => {
  const frames = sampleRate * seconds;
  const pcmBytes = frames * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.sin((2 * Math.PI * toneFrequency * frame) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 20_000), 44 + frame * 2);
  }
  return wav;
};

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.hiverun.audioe2e">
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <application android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity
      android:name=".MainActivity"
      android:exported="true"
      android:launchMode="singleTop">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`;

const activitySource = `package com.hiverun.audioe2e;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;

public final class MainActivity extends Activity {
  private static final String STOP_ACTION = "com.hiverun.audioe2e.STOP";
  private AudioRecord audioRecord;
  private Thread captureThread;
  private volatile boolean recording;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    TextView status = new TextView(this);
    status.setText("Recording browser-injected microphone audio");
    setContentView(status);
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      startCapture();
    } else {
      requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 1);
    }
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (STOP_ACTION.equals(intent.getAction())) {
      stopCapture();
      finish();
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
      startCapture();
    }
  }

  private void startCapture() {
    int minimum = AudioRecord.getMinBufferSize(
      48000,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    );
    audioRecord = new AudioRecord(
      MediaRecorder.AudioSource.MIC,
      48000,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      Math.max(minimum * 2, 8192)
    );
    recording = true;
    audioRecord.startRecording();
    captureThread = new Thread(() -> {
      byte[] buffer = new byte[1920];
      File output = new File(getExternalFilesDir(null), "capture.pcm");
      try (FileOutputStream stream = new FileOutputStream(output, false)) {
        while (recording) {
          int count = audioRecord.read(buffer, 0, buffer.length);
          if (count > 0) {
            stream.write(buffer, 0, count);
          }
        }
      } catch (Exception error) {
        throw new RuntimeException(error);
      }
    }, "audio-e2e-capture");
    captureThread.start();
  }

  private void stopCapture() {
    if (!recording) {
      return;
    }
    recording = false;
    audioRecord.stop();
    try {
      captureThread.join(3000);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
    }
    audioRecord.release();
  }

  @Override
  public void onDestroy() {
    stopCapture();
    super.onDestroy();
  }
}
`;

const latestAndroidComponent = async (
  directory: string,
  prefix = ""
): Promise<string> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    );
  const latest = versions.at(-1);
  if (!latest) {
    throw new Error(`No Android SDK component found in ${directory}.`);
  }
  return latest;
};

const buildRecorderApk = async (directory: string): Promise<string> => {
  const buildToolsRoot = path.join(androidHome, "build-tools");
  const platformRoot = path.join(androidHome, "platforms");
  const buildToolsVersion = await latestAndroidComponent(buildToolsRoot);
  const platformVersion = await latestAndroidComponent(
    platformRoot,
    "android-"
  );
  const targetApi = platformVersion.slice("android-".length);
  const buildTools = path.join(buildToolsRoot, buildToolsVersion);
  const androidJar = path.join(platformRoot, platformVersion, "android.jar");
  const sourceDirectory = path.join(
    directory,
    "src",
    "com",
    "hiverun",
    "audioe2e"
  );
  const classesDirectory = path.join(directory, "classes");
  const dexDirectory = path.join(directory, "dex");
  const manifestPath = path.join(directory, "AndroidManifest.xml");
  const sourcePath = path.join(sourceDirectory, "MainActivity.java");
  const unsignedApk = path.join(directory, "unsigned.apk");
  const alignedApk = path.join(directory, "aligned.apk");
  const signedApk = path.join(directory, "recorder.apk");
  const keystore = path.join(directory, "debug.keystore");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(classesDirectory, { recursive: true });
  await mkdir(dexDirectory, { recursive: true });
  await writeFile(manifestPath, manifest);
  await writeFile(sourcePath, activitySource);
  await run("javac", [
    "-source",
    "8",
    "-target",
    "8",
    "-classpath",
    androidJar,
    "-d",
    classesDirectory,
    sourcePath,
  ]);
  await run(path.join(buildTools, "d8"), [
    "--lib",
    androidJar,
    "--output",
    dexDirectory,
    path.join(classesDirectory, "com/hiverun/audioe2e/MainActivity.class"),
  ]);
  await run(path.join(buildTools, "aapt2"), [
    "link",
    "-I",
    androidJar,
    "--manifest",
    manifestPath,
    "--min-sdk-version",
    "23",
    "--target-sdk-version",
    targetApi,
    "-o",
    unsignedApk,
  ]);
  await run("zip", ["-j", unsignedApk, path.join(dexDirectory, "classes.dex")]);
  await run(path.join(buildTools, "zipalign"), [
    "-f",
    "4",
    unsignedApk,
    alignedApk,
  ]);
  await run("keytool", [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storepass",
    "android",
    "-alias",
    "androiddebugkey",
    "-keypass",
    "android",
    "-dname",
    "CN=Android Debug,O=Android,C=US",
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "10000",
  ]);
  await run(path.join(buildTools, "apksigner"), [
    "sign",
    "--ks",
    keystore,
    "--ks-pass",
    "pass:android",
    "--key-pass",
    "pass:android",
    "--out",
    signedApk,
    alignedApk,
  ]);
  return signedApk;
};

const waitForViewer = async (
  viewer: ChildProcess,
  requestedPort: number,
  output: () => string
): Promise<string> => {
  const deadline = Date.now() + 15_000;
  const url = `http://127.0.0.1:${requestedPort}`;
  while (Date.now() < deadline) {
    if (viewer.exitCode !== null) {
      throw new Error(`Viewer exited before startup.\n${output()}`);
    }
    const ready = await fetch(url, { signal: AbortSignal.timeout(1000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      return url;
    }
    await sleep(100);
  }
  throw new Error(
    `Viewer did not start from requested port ${requestedPort}.\n${output()}`
  );
};

const waitForRecorder = async (): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (microphoneCaptureIsRunning(await adb("shell", "dumpsys", "audio"))) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Android AudioRecord consumer did not become active.");
};

const analyzePcm = (
  pcm: Buffer
): {
  activeDurationMs: number;
  activeSpanMs: number;
  firstActiveMs: number;
  longestDropoutMs: number;
  rms: number;
  toneRatio: number;
} => {
  const frameSamples = (sampleRate * audioFrameMilliseconds) / 1000;
  if (pcm.length < sampleRate * 2) {
    throw new Error(`Guest capture was too short (${pcm.length} bytes).`);
  }
  const frameCount = Math.floor(pcm.length / 2 / frameSamples);
  const activeFrames: boolean[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let energy = 0;
    for (let sampleIndex = 0; sampleIndex < frameSamples; sampleIndex += 1) {
      const byteOffset = (frameIndex * frameSamples + sampleIndex) * 2;
      const sample = pcm.readInt16LE(byteOffset) / 32_768;
      energy += sample * sample;
    }
    activeFrames.push(Math.sqrt(energy / frameSamples) >= 0.02);
  }
  const firstActiveFrame = activeFrames.indexOf(true);
  const lastActiveFrame = activeFrames.lastIndexOf(true);
  if (firstActiveFrame === -1 || lastActiveFrame === -1) {
    return {
      activeDurationMs: 0,
      activeSpanMs: 0,
      firstActiveMs: 0,
      longestDropoutMs: 0,
      rms: 0,
      toneRatio: 0,
    };
  }

  let activeFrameCount = 0;
  let silentRun = 0;
  let longestSilentRun = 0;
  for (let index = firstActiveFrame; index <= lastActiveFrame; index += 1) {
    if (activeFrames[index]) {
      activeFrameCount += 1;
      silentRun = 0;
    } else {
      silentRun += 1;
      longestSilentRun = Math.max(longestSilentRun, silentRun);
    }
  }

  const firstSample = firstActiveFrame * frameSamples;
  const sampleCount = (lastActiveFrame - firstActiveFrame + 1) * frameSamples;
  let energy = 0;
  let sine = 0;
  let cosine = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE((firstSample + index) * 2) / 32_768;
    const phase = (2 * Math.PI * toneFrequency * index) / sampleRate;
    energy += sample * sample;
    sine += sample * Math.sin(phase);
    cosine += sample * Math.cos(phase);
  }
  const rms = Math.sqrt(energy / sampleCount);
  const toneAmplitude =
    (2 * Math.sqrt(sine * sine + cosine * cosine)) / sampleCount;
  return {
    activeDurationMs: activeFrameCount * audioFrameMilliseconds,
    activeSpanMs:
      (lastActiveFrame - firstActiveFrame + 1) * audioFrameMilliseconds,
    firstActiveMs: firstActiveFrame * audioFrameMilliseconds,
    longestDropoutMs: longestSilentRun * audioFrameMilliseconds,
    rms,
    toneRatio: rms === 0 ? 0 : toneAmplitude / (rms * Math.SQRT2),
  };
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The single E2E lifecycle keeps emulator mutations inside one cleanup boundary.
const main = async (): Promise<void> => {
  if (!androidHome) {
    throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT is required.");
  }
  if (!serial) {
    throw new Error(
      "ANDROID_SERIAL is required so this test cannot select an unrelated emulator."
    );
  }
  const avdName = (await adb("emu", "avd", "name")).trim().split("\n")[0];
  if (!avdName) {
    throw new Error(`Could not identify Android emulator ${serial}.`);
  }
  if (
    !avdName.startsWith("Hive_") &&
    process.env.HIVE_AUDIO_E2E_ALLOW_ANY_AVD !== "1"
  ) {
    throw new Error(
      `Refusing to use AVD ${avdName}; set HIVE_AUDIO_E2E_ALLOW_ANY_AVD=1 to override.`
    );
  }

  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "hive-stream-droid-audio-")
  );
  const viewerPort = await reservePort();
  const tonePath = path.join(tempDirectory, "browser-tone.wav");
  const guestPcmPath = path.join(tempDirectory, "guest-capture.pcm");
  const viewerExecutable = fileURLToPath(
    import.meta.resolve("stream-droid/bin/stream-droid.mjs")
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let viewer: ReturnType<typeof spawn> | undefined;
  let viewerExit: Promise<number> | undefined;
  let viewerOutput = "";

  try {
    console.log(`Building Android recorder helper in ${tempDirectory}`);
    const recorderApk = await buildRecorderApk(tempDirectory);
    await writeFile(tonePath, createToneWav(12));
    await adb("install", "-r", recorderApk);
    await adb(
      "shell",
      "pm",
      "grant",
      packageName,
      "android.permission.RECORD_AUDIO"
    );
    await adb("shell", "rm", "-f", recordingPath);

    viewer = spawn(
      process.execPath,
      [
        viewerExecutable,
        "--serial",
        serial,
        "--capture",
        "grpc",
        "--port",
        String(viewerPort),
        "--host",
        "127.0.0.1",
        "--headless",
        "--verbose",
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          HIVE_ANDROID_STREAM_DROID_STRICT_PORT: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    viewerExit = waitForChildExit(viewer);
    viewer.stdout?.on("data", (chunk) => {
      viewerOutput += chunk.toString();
    });
    viewer.stderr?.on("data", (chunk) => {
      viewerOutput += chunk.toString();
    });
    const viewerUrl = await waitForViewer(
      viewer,
      viewerPort,
      () => viewerOutput
    );

    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${tonePath}`,
      ],
    });
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    const readPermissionRequestCount = () =>
      page.evaluate(
        () =>
          (window as Window & { hiveGetUserMediaCalls?: number })
            .hiveGetUserMediaCalls ?? 0
      );
    await page.goto(`${viewerUrl}/?serial=${encodeURIComponent(serial)}`);
    await page.evaluate(() => {
      const mediaDevices = navigator.mediaDevices;
      const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.assign(window, { hiveGetUserMediaCalls: 0 });
      mediaDevices.getUserMedia = (...args) => {
        Object.assign(window, {
          hiveGetUserMediaCalls:
            ((window as Window & { hiveGetUserMediaCalls?: number })
              .hiveGetUserMediaCalls ?? 0) + 1,
        });
        return getUserMedia(...args);
      };
    });
    const startMicrophone = page.getByRole("button", {
      name: "Use browser microphone",
    });
    await startMicrophone.waitFor({ state: "visible" });
    await startMicrophone.click();
    await page.waitForTimeout(100);
    const permissionRequestsBeforeGuestCapture =
      await readPermissionRequestCount();
    if (permissionRequestsBeforeGuestCapture !== 0) {
      throw new Error(
        "Browser microphone permission was requested before Android started recording."
      );
    }
    await adb("shell", "am", "start", "-n", `${packageName}/.MainActivity`);
    await waitForRecorder();
    const recorderReadyAt = Date.now();
    await page
      .getByRole("button", { name: "Stop browser microphone" })
      .waitFor({ state: "visible", timeout: 15_000 });
    const permissionRequestCount = await readPermissionRequestCount();
    if (permissionRequestCount !== 1) {
      throw new Error(
        `Expected one browser microphone permission request, received ${permissionRequestCount}.`
      );
    }
    const microphoneLiveAt = Date.now();
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: "Stop browser microphone" }).click();
    await page
      .getByRole("button", { name: "Use browser microphone" })
      .waitFor({ state: "visible" });

    await adb(
      "shell",
      "am",
      "start",
      "-a",
      `${packageName}.STOP`,
      "-n",
      `${packageName}/.MainActivity`
    );
    await sleep(500);
    await adb("pull", recordingPath, guestPcmPath);
    const pcm = await readFile(guestPcmPath);
    const result = analyzePcm(pcm);
    if (result.rms < 0.02) {
      throw new Error(
        `Guest microphone capture was effectively silent (RMS ${result.rms.toFixed(4)}).`
      );
    }
    if (result.toneRatio < 0.5) {
      throw new Error(
        `Guest capture did not contain the ${toneFrequency} Hz browser tone (ratio ${result.toneRatio.toFixed(3)}).`
      );
    }
    const startupLatencyMs =
      result.firstActiveMs - (microphoneLiveAt - recorderReadyAt);
    if (result.activeDurationMs < 3800) {
      throw new Error(
        `Guest microphone delivered only ${result.activeDurationMs}ms of the 4000ms browser tone.`
      );
    }
    if (result.activeSpanMs > 4200) {
      throw new Error(
        `Guest microphone tone stretched to ${result.activeSpanMs}ms, indicating queued audio.`
      );
    }
    if (result.longestDropoutMs > 80) {
      throw new Error(
        `Guest microphone had a ${result.longestDropoutMs}ms audio dropout.`
      );
    }
    if (startupLatencyMs > 300) {
      throw new Error(
        `Guest microphone started ${startupLatencyMs}ms after browser capture became live.`
      );
    }
    console.log(
      `Browser microphone reached Android: ${pcm.length} bytes, ${result.activeDurationMs}ms active over ${result.activeSpanMs}ms, startup latency ${startupLatencyMs}ms, longest dropout ${result.longestDropoutMs}ms, RMS ${result.rms.toFixed(4)}, ${toneFrequency} Hz ratio ${result.toneRatio.toFixed(3)}`
    );
  } finally {
    await browser?.close().catch(() => {
      /* Cleanup is best-effort after the E2E result is known. */
    });
    if (viewer && viewerExit) {
      await terminateChild(viewer, viewerExit).catch(() => {
        /* Cleanup is best-effort after the E2E result is known. */
      });
    }
    await adb("shell", "am", "force-stop", packageName).catch(() => {
      /* The helper may not have reached installation. */
    });
    await adb("uninstall", packageName).catch(() => {
      /* The helper may not have reached installation. */
    });
    if (process.env.HIVE_E2E_KEEP_ARTIFACTS === "1") {
      console.log(`Kept E2E artifacts at ${tempDirectory}`);
    } else {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
};

await main();
