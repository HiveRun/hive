// biome-ignore-all lint/style/noMagicNumbers: Fixed audio frame sizes and spectral thresholds are the behavior under test.
import { describe, expect, it } from "vitest";

import { analyzePcm, createToneWav } from "../e2e/browser-microphone";

describe("Android audio evidence analysis", () => {
  it("detects the injected tone across dropouts and phase discontinuities", () => {
    const tone = createToneWav(3).subarray(44);
    const frameBytes = 1920;
    const silence = Buffer.alloc(frameBytes * 2);
    const fragments: Buffer[] = [];
    for (let offset = 0; offset < tone.length; offset += frameBytes * 5 + 200) {
      fragments.push(tone.subarray(offset, offset + frameBytes * 3), silence);
    }

    const metrics = analyzePcm(Buffer.concat(fragments));
    expect(metrics.toneRatio).toBeGreaterThan(0.9);
    expect(metrics.longestDropoutMs).toBe(40);
  });
});
