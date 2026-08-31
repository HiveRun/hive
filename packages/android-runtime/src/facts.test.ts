import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ,
  HIVE_ANDROID_CONSOLE_PORT_MAX,
  HIVE_ANDROID_CONSOLE_PORT_MIN,
  HIVE_ANDROID_CONSOLE_PORTS,
  HIVE_ANDROID_MICROPHONE_FRAME_BYTES,
  HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS,
  HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES,
  HIVE_ANDROID_PCM_BYTES_PER_SAMPLE,
  HIVE_ANDROID_RESERVED_CONSOLE_PORT,
  resolveHiveAndroidAvdName,
  resolveHiveAndroidSerial,
} from "./facts";

const EXPECTED_MICROPHONE_FRAME_DURATION_MS = 20;
const EXPECTED_AUDIO_FRAME_DECLARATIONS = 2;
const MICROSECONDS_PER_MILLISECOND = 1000;

describe("Android runtime facts", () => {
  it("defines the production lease range and identity format", () => {
    expect(HIVE_ANDROID_CONSOLE_PORTS.at(0)).toBe(
      HIVE_ANDROID_CONSOLE_PORT_MIN
    );
    expect(HIVE_ANDROID_CONSOLE_PORTS.at(-1)).toBe(
      HIVE_ANDROID_CONSOLE_PORT_MAX
    );
    expect(HIVE_ANDROID_CONSOLE_PORTS).not.toContain(
      HIVE_ANDROID_RESERVED_CONSOLE_PORT
    );
    expect(resolveHiveAndroidSerial(HIVE_ANDROID_CONSOLE_PORT_MIN)).toBe(
      "emulator-5554"
    );
    expect(resolveHiveAndroidAvdName("cell:a/b")).toBe("Hive_Pixel_7_cell_a_b");
  });

  it("stays aligned with the patched microphone transport", () => {
    const patch = readFileSync(
      join(import.meta.dirname, "../../../patches/stream-droid@0.5.0.patch"),
      "utf8"
    );
    const formattedSampleRate =
      HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ.toLocaleString("en-US").replaceAll(
        ",",
        "_"
      );
    const formattedTimestampIncrement = (
      HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS * MICROSECONDS_PER_MILLISECOND
    )
      .toLocaleString("en-US")
      .replaceAll(",", "_");

    expect(HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS).toBe(
      EXPECTED_MICROPHONE_FRAME_DURATION_MS
    );
    expect(patch).toContain(
      `+const MICROPHONE_SAMPLE_RATE = ${formattedSampleRate};`
    );
    expect(patch).toContain(
      `+const MICROPHONE_FRAME_SAMPLES = ${HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES};`
    );
    expect(patch).toContain(
      `+const AUDIO_SAMPLE_RATE = ${HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ};`
    );
    const frameBytesDeclaration = `+const AUDIO_FRAME_BYTES = ${HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES} * ${HIVE_ANDROID_PCM_BYTES_PER_SAMPLE};`;
    expect(patch.split(frameBytesDeclaration)).toHaveLength(
      EXPECTED_AUDIO_FRAME_DECLARATIONS + 1
    );
    expect(HIVE_ANDROID_MICROPHONE_FRAME_BYTES).toBe(
      HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES * HIVE_ANDROID_PCM_BYTES_PER_SAMPLE
    );
    expect(patch).toContain(
      `+const AUDIO_FRAME_INTERVAL_MS = ${HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS};`
    );
    expect(patch).toContain(`nextTimestamp += ${formattedTimestampIncrement};`);
    expect(patch).toContain(
      `+              await new Promise((resolve) => setTimeout(resolve, ${HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS}));`
    );
  });
});
