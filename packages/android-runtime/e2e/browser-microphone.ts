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

import { terminateChild, waitForChildExit } from "../src/process";

export const audioRecorderPackageName = "com.hiverun.audioe2e";
export const androidAudioSampleRate = 48_000;
export const browserToneFrequency = 997;
export const microphoneSpeechPilotFrequency = 1500;
export const outputSpeechPilotFrequency = 2300;
const audioFrameMilliseconds = 20;
export const audioSendDurationMilliseconds = 6000;
const audioSpanToleranceMilliseconds = 200;
export const guestRecordingPath = `/sdcard/Android/data/${audioRecorderPackageName}/files/capture.pcm`;
export const guestPlaybackCompletePath = `/sdcard/Android/data/${audioRecorderPackageName}/files/playback.done`;
export const guestPlaybackStartedPath = `/sdcard/Android/data/${audioRecorderPackageName}/files/playback.started`;
export const guestPlaybackPath = `/sdcard/Android/data/${audioRecorderPackageName}/files/playback.pcm`;
export const guestPlaybackSourcePath = `/sdcard/Android/data/${audioRecorderPackageName}/files/playback-source.pcm`;
const androidHome =
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "";
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoRoot = path.resolve(packageRoot, "../..");
const RECORD_ACTIVITY_MONITOR_PATTERN =
  /RecordActivityMonitor[\s\S]*?(?=\nAudioDeviceBroker:|$)/;
const ACTIVE_RECORDING_PATTERN = /^riid\s+\d+;\s+active\?\s+true$/m;

const microphoneCaptureIsRunning = (status: string): boolean => {
  const monitor = status.match(RECORD_ACTIVITY_MONITOR_PATTERN)?.[0];
  return monitor ? ACTIVE_RECORDING_PATTERN.test(monitor) : false;
};

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

const getAndroidSerial = () => process.env.ANDROID_SERIAL?.trim() ?? "";

export const adb = (...args: string[]): Promise<string> =>
  run("adb", ["-s", getAndroidSerial(), ...args]);

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

export const createToneWav = (seconds: number): Buffer => {
  const frames = androidAudioSampleRate * seconds;
  const pcmBytes = frames * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(androidAudioSampleRate, 24);
  wav.writeUInt32LE(androidAudioSampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.sin(
      (2 * Math.PI * browserToneFrequency * frame) / androidAudioSampleRate
    );
    wav.writeInt16LE(Math.round(sample * 20_000), 44 + frame * 2);
  }
  return wav;
};

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.hiverun.audioe2e">
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
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
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioAttributes;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.widget.TextView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

public final class MainActivity extends Activity {
  private static final String STOP_ACTION = "com.hiverun.audioe2e.STOP";
  private static final String PLAYBACK_ACTION = "com.hiverun.audioe2e.PLAYBACK";
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
    } else if (PLAYBACK_ACTION.equals(intent.getAction())) {
      stopCapture();
      new Thread(() -> {
        playCapture();
        runOnUiThread(this::finish);
      }, "audio-e2e-playback").start();
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

  private void playCapture() {
    File input = new File(getExternalFilesDir(null), "playback-source.pcm");
    File playback = new File(getExternalFilesDir(null), "playback.pcm");
    File started = new File(getExternalFilesDir(null), "playback.started");
    File complete = new File(getExternalFilesDir(null), "playback.done");
    AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    audioManager.setStreamVolume(
      AudioManager.STREAM_MUSIC,
      audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
      0
    );
    int playbackMinimum = AudioTrack.getMinBufferSize(
      48000,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    );
    AudioTrack track = new AudioTrack.Builder()
      .setAudioAttributes(
        new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      )
      .setAudioFormat(
        new AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(48000)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setBufferSizeInBytes(Math.max(playbackMinimum * 2, 8192))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build();
    track.setVolume(1.0f);
    byte[] buffer = new byte[1920];
    boolean startedPlayback = false;
    try (
      FileInputStream stream = new FileInputStream(input);
      FileOutputStream playbackStream = new FileOutputStream(playback, false)
    ) {
      track.play();
      int count;
      while ((count = stream.read(buffer)) > 0) {
        int offset = 0;
        while (offset < count) {
          int written = track.write(buffer, offset, count - offset);
          if (written <= 0) {
            throw new RuntimeException("AudioTrack rejected playback with code " + written);
          }
          playbackStream.write(buffer, offset, written);
          offset += written;
          if (!startedPlayback) {
            started.createNewFile();
            startedPlayback = true;
          }
        }
      }
      track.stop();
      complete.createNewFile();
    } catch (Exception error) {
      throw new RuntimeException(error);
    } finally {
      track.release();
    }
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

export const buildRecorderApk = async (directory: string): Promise<string> => {
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

export const waitForRecorder = async (): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (microphoneCaptureIsRunning(await adb("shell", "dumpsys", "audio"))) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Android AudioRecord consumer did not become active.");
};

const analyzePcmFrame = (
  pcm: Buffer,
  frameIndex: number,
  frameSamples: number,
  toneFrequency: number
): { rms: number; toneRatio: number } => {
  let energy = 0;
  let sine = 0;
  let cosine = 0;
  for (let sampleIndex = 0; sampleIndex < frameSamples; sampleIndex += 1) {
    const byteOffset = (frameIndex * frameSamples + sampleIndex) * 2;
    const sample = pcm.readInt16LE(byteOffset) / 32_768;
    const phase =
      (2 * Math.PI * toneFrequency * sampleIndex) / androidAudioSampleRate;
    energy += sample * sample;
    sine += sample * Math.sin(phase);
    cosine += sample * Math.cos(phase);
  }
  const rms = Math.sqrt(energy / frameSamples);
  const toneAmplitude =
    (2 * Math.sqrt(sine * sine + cosine * cosine)) / frameSamples;
  return {
    rms,
    toneRatio: rms === 0 ? 0 : toneAmplitude / (rms * Math.SQRT2),
  };
};

export const analyzePcm = (
  pcm: Buffer,
  toneFrequency = browserToneFrequency,
  activeRmsThreshold = 0.02
): {
  activeDurationMs: number;
  activeSpanMs: number;
  firstActiveMs: number;
  longestDropoutMs: number;
  rms: number;
  toneRatio: number;
} => {
  const frameSamples = (androidAudioSampleRate * audioFrameMilliseconds) / 1000;
  if (pcm.length < androidAudioSampleRate * 2) {
    throw new Error(`Guest capture was too short (${pcm.length} bytes).`);
  }
  const frameCount = Math.floor(pcm.length / 2 / frameSamples);
  const frames: Array<{ rms: number; toneRatio: number }> = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    frames.push(analyzePcmFrame(pcm, frameIndex, frameSamples, toneFrequency));
  }
  const activeFrames = frames.map((frame) => frame.rms >= activeRmsThreshold);
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
  let toneRatioTotal = 0;
  let silentRun = 0;
  let longestSilentRun = 0;
  for (let index = firstActiveFrame; index <= lastActiveFrame; index += 1) {
    if (activeFrames[index]) {
      activeFrameCount += 1;
      toneRatioTotal += frames[index]?.toneRatio ?? 0;
      silentRun = 0;
    } else {
      silentRun += 1;
      longestSilentRun = Math.max(longestSilentRun, silentRun);
    }
  }

  const firstSample = firstActiveFrame * frameSamples;
  const sampleCount = (lastActiveFrame - firstActiveFrame + 1) * frameSamples;
  let energy = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE((firstSample + index) * 2) / 32_768;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / sampleCount);
  return {
    activeDurationMs: activeFrameCount * audioFrameMilliseconds,
    activeSpanMs:
      (lastActiveFrame - firstActiveFrame + 1) * audioFrameMilliseconds,
    firstActiveMs: firstActiveFrame * audioFrameMilliseconds,
    longestDropoutMs: longestSilentRun * audioFrameMilliseconds,
    rms,
    toneRatio: toneRatioTotal / activeFrameCount,
  };
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The single E2E lifecycle keeps emulator mutations inside one cleanup boundary.
const main = async (): Promise<void> => {
  const serial = getAndroidSerial();
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
      audioRecorderPackageName,
      "android.permission.RECORD_AUDIO"
    );
    await adb("shell", "rm", "-f", guestRecordingPath);

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
          HIVE_SERVICE_AUDIO_INPUT: "1",
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
    await page.addInitScript(() => {
      const mediaDevices = navigator.mediaDevices;
      const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      const sendWebSocket = WebSocket.prototype.send;
      Object.assign(window, {
        hiveActiveMicrophoneTracks: 0,
        hiveGetUserMediaCalls: 0,
        hiveGetUserMediaConstraints: [],
        hiveMicrophoneFrames: 0,
      });
      WebSocket.prototype.send = function send(
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
        sendWebSocket.call(this, data);
      };
      mediaDevices.getUserMedia = async (...args) => {
        const callCount =
          ((window as Window & { hiveGetUserMediaCalls?: number })
            .hiveGetUserMediaCalls ?? 0) + 1;
        Object.assign(window, {
          hiveGetUserMediaCalls: callCount,
          hiveGetUserMediaConstraints: [
            ...((
              window as Window & {
                hiveGetUserMediaConstraints?: MediaStreamConstraints[];
              }
            ).hiveGetUserMediaConstraints ?? []),
            args[0],
          ],
        });
        if (callCount === 1) {
          throw new DOMException("Requested device not found", "NotFoundError");
        }
        const stream = await getUserMedia(...args);
        for (const track of stream.getAudioTracks()) {
          const stop = track.stop.bind(track);
          Object.assign(window, {
            hiveActiveMicrophoneTracks:
              ((window as Window & { hiveActiveMicrophoneTracks?: number })
                .hiveActiveMicrophoneTracks ?? 0) + 1,
          });
          track.stop = () => {
            Object.assign(window, {
              hiveActiveMicrophoneTracks:
                ((
                  window as Window & {
                    hiveActiveMicrophoneTracks?: number;
                  }
                ).hiveActiveMicrophoneTracks ?? 1) - 1,
            });
            stop();
          };
        }
        return stream;
      };
    });
    await page.goto(`${viewerUrl}/?serial=${encodeURIComponent(serial)}`);
    await page.waitForTimeout(100);
    const permissionRequestsBeforeGuestCapture =
      await readPermissionRequestCount();
    if (permissionRequestsBeforeGuestCapture !== 0) {
      throw new Error(
        "Browser microphone permission was requested before Android started recording."
      );
    }
    await adb(
      "shell",
      "am",
      "start",
      "-n",
      `${audioRecorderPackageName}/.MainActivity`
    );
    await waitForRecorder();
    const recorderReadyAt = Date.now();
    await page.waitForFunction(
      () =>
        (window as Window & { hiveGetUserMediaCalls?: number })
          .hiveGetUserMediaCalls === 2,
      undefined,
      { timeout: 15_000 }
    );
    const permissionRequestCount = await readPermissionRequestCount();
    if (permissionRequestCount !== 2) {
      throw new Error(
        `Expected constrained and fallback microphone requests, received ${permissionRequestCount}.`
      );
    }
    const fallbackConstraintsAreRelaxed = await page.evaluate(() => {
      const constraints = (
        window as Window & {
          hiveGetUserMediaConstraints?: MediaStreamConstraints[];
        }
      ).hiveGetUserMediaConstraints?.[1];
      const audio = constraints?.audio;
      return (
        typeof audio === "object" &&
        audio !== null &&
        audio.autoGainControl === false &&
        audio.echoCancellation === false &&
        audio.noiseSuppression === false &&
        !("channelCount" in audio) &&
        !("sampleRate" in audio)
      );
    });
    if (!fallbackConstraintsAreRelaxed) {
      throw new Error(
        "Fallback microphone request did not relax only channel and sample-rate constraints."
      );
    }
    await page
      .waitForFunction(
        () =>
          ((window as Window & { hiveMicrophoneFrames?: number })
            .hiveMicrophoneFrames ?? 0) > 0,
        undefined,
        { timeout: 15_000 }
      )
      .catch(async (error) => {
        throw new Error(
          `Browser microphone produced no frames. Viewer text: ${await page.locator("body").innerText()}\nViewer output:\n${viewerOutput}`,
          { cause: error }
        );
      });
    const microphoneLiveAt = Date.now();
    await page.waitForTimeout(audioSendDurationMilliseconds);

    const guestCaptureStoppedAt = Date.now();
    await adb("shell", "am", "force-stop", audioRecorderPackageName);
    await page.waitForFunction(
      () =>
        (window as Window & { hiveActiveMicrophoneTracks?: number })
          .hiveActiveMicrophoneTracks === 0,
      undefined,
      { timeout: 15_000 }
    );
    const browserTrackCleanupMs = Date.now() - guestCaptureStoppedAt;
    if (browserTrackCleanupMs > 1500) {
      throw new Error(
        `Browser microphone track took ${browserTrackCleanupMs}ms to stop after guest capture ended.`
      );
    }
    await sleep(500);
    await adb("pull", guestRecordingPath, guestPcmPath);
    const pcm = await readFile(guestPcmPath);
    const result = analyzePcm(pcm);
    const startupLatencyMs =
      result.firstActiveMs - (microphoneLiveAt - recorderReadyAt);
    console.log(
      `Browser microphone reached Android: ${pcm.length} bytes, ${result.activeDurationMs}ms active over ${result.activeSpanMs}ms, startup latency ${startupLatencyMs}ms, track cleanup ${browserTrackCleanupMs}ms, longest dropout ${result.longestDropoutMs}ms, RMS ${result.rms.toFixed(4)}, ${browserToneFrequency} Hz ratio ${result.toneRatio.toFixed(3)}`
    );
    if (result.rms < 0.02) {
      throw new Error(
        `Guest microphone capture was effectively silent (RMS ${result.rms.toFixed(4)}).`
      );
    }
    if (result.toneRatio < 0.5) {
      throw new Error(
        `Guest capture did not contain the ${browserToneFrequency} Hz browser tone (ratio ${result.toneRatio.toFixed(3)}).`
      );
    }
    if (result.activeDurationMs < 3800) {
      throw new Error(
        `Guest microphone delivered only ${result.activeDurationMs}ms of the 4000ms browser tone.`
      );
    }
    if (
      result.activeSpanMs >
      audioSendDurationMilliseconds + audioSpanToleranceMilliseconds
    ) {
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
  } finally {
    await browser?.close().catch(() => {
      /* Cleanup is best-effort after the E2E result is known. */
    });
    if (viewer && viewerExit) {
      await terminateChild(viewer, viewerExit).catch(() => {
        /* Cleanup is best-effort after the E2E result is known. */
      });
    }
    await adb("shell", "am", "force-stop", audioRecorderPackageName).catch(
      () => {
        /* The helper may not have reached installation. */
      }
    );
    await adb("uninstall", audioRecorderPackageName).catch(() => {
      /* The helper may not have reached installation. */
    });
    if (process.env.HIVE_E2E_KEEP_ARTIFACTS === "1") {
      console.log(`Kept E2E artifacts at ${tempDirectory}`);
    } else {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
};

if (import.meta.main) {
  await main();
}
