// biome-ignore-all lint/style/noMagicNumbers: Values are protocol fields, frame sizes, and timing thresholds under test.
import { createInjectedAudioPacket } from "stream-droid/src/grpc/emulatorClient.ts";
import {
  createAudioFrameQueue,
  createPacedAudioInjection,
  microphoneCaptureIsRunning,
  originsMatch,
  serviceAudioInputEnabled,
} from "stream-droid/src/wsServer.ts";
import { expect, test } from "vitest";

test("formats the first emulator microphone packet", () => {
  const pcm = Buffer.from([0, 1, 2, 3]);
  expect(createInjectedAudioPacket(pcm, true, 123)).toEqual({
    format: {
      samplingRate: 48_000,
      channels: 0,
      format: 1,
      mode: 0,
    },
    timestamp: 123,
    audio: pcm,
  });
  expect(createInjectedAudioPacket(pcm, false, 456)).toEqual({
    timestamp: 456,
    audio: pcm,
  });
});

test("bounds microphone latency by discarding the oldest queued frames", () => {
  const queue = createAudioFrameQueue(2);
  const first = Buffer.alloc(1920, 1);
  const second = Buffer.alloc(1920, 2);
  const latest = Buffer.alloc(1920, 3);

  expect(queue.push(Buffer.concat([first, second]))).toBe(0);
  expect(queue.push(latest)).toBe(1);
  expect(queue.size).toBe(2);
  expect(queue.shift()).toEqual(second);
  expect(queue.shift()).toEqual(latest);
  expect(queue.shift()).toBeUndefined();
});

test("releases microphone injection after browser audio goes idle", async () => {
  let idleCount = 0;
  let stopCount = 0;
  const injection = createPacedAudioInjection(
    {
      onDrain: () => {
        /* The fake writer never applies backpressure. */
      },
      stop: () => {
        stopCount += 1;
        return Promise.resolve();
      },
      write: () => true,
    },
    "emulator-5580",
    () => {
      idleCount += 1;
    },
    25
  );

  injection.write(Buffer.alloc(1920));
  await new Promise((resolve) => setTimeout(resolve, 70));
  expect(idleCount).toBe(1);
  await injection.stop();
  expect(stopCount).toBe(1);
});

test("requires microphone WebSockets to match the viewer origin", () => {
  expect(originsMatch("http://localhost:40513", "localhost:40513")).toBe(true);
  expect(originsMatch("https://viewer.example.com", "viewer.example.com")).toBe(
    true
  );
  expect(originsMatch("https://evil.example.com", "localhost:40513")).toBe(
    false
  );
  expect(originsMatch("null", "localhost:40513")).toBe(false);
  expect(originsMatch(undefined, "localhost:40513")).toBe(false);
});

test("requires an active Android microphone consumer", () => {
  expect(
    microphoneCaptureIsRunning(`RecordActivityMonitor dump time: 11:53:25 PM
riid 143; active? true
  session:177 -- source client=MIC -- pack:com.hiverun.app.dev

Events log: recording activity received by AudioService
08-05 23:53:13:269 rec start riid:143

AudioDeviceBroker:`)
  ).toBe(true);
  expect(
    microphoneCaptureIsRunning(`RecordActivityMonitor dump time: 11:53:25 PM

Events log: recording activity received by AudioService
08-05 23:53:13:269 rec start riid:143

AudioDeviceBroker:`)
  ).toBe(false);
  expect(microphoneCaptureIsRunning("riid 143; active? true\n")).toBe(false);
});

test("requires service audio input to be explicitly enabled", () => {
  expect(serviceAudioInputEnabled({})).toBe(false);
  expect(serviceAudioInputEnabled({ HIVE_SERVICE_AUDIO_INPUT: "0" })).toBe(
    false
  );
  expect(serviceAudioInputEnabled({ HIVE_SERVICE_AUDIO_INPUT: "1" })).toBe(
    true
  );
});
