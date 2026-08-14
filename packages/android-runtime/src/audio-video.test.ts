import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAndroidAudioVideoMuxArgs } from "../e2e/audio-video";

describe("Android audio video mux", () => {
  it("trims evidence chapters and labels distinct input and output phases", () => {
    const args = buildAndroidAudioVideoMuxArgs({
      artifactsDir: "/tmp/artifacts",
      metadata: {
        segments: [
          {
            label: "BEFORE SERVICE RESTART",
            microphonePcm: "microphone-before.pcm",
            microphoneActiveDurationMs: 6000,
            microphoneActiveOffsetMs: 2200,
            microphoneOffsetMs: 1200,
            outputPcm: "output-before.pcm",
            outputActiveDurationMs: 7000,
            outputActiveOffsetMs: 8500,
            outputOffsetMs: 8300,
            videoEndMs: 16_000,
            videoStartMs: 1000,
          },
          {
            label: "AFTER SERVICE RESTART",
            microphonePcm: "microphone-after.pcm",
            microphoneActiveDurationMs: 5800,
            microphoneActiveOffsetMs: 22_000,
            microphoneOffsetMs: 21_500,
            outputPcm: "output-after.pcm",
            outputActiveDurationMs: 6800,
            outputActiveOffsetMs: 28_500,
            outputOffsetMs: 28_300,
            videoEndMs: 36_000,
            videoStartMs: 20_000,
          },
        ],
      },
      outputPath: "/tmp/artifacts/evidence.mp4",
      timelineOffsetMs: 300,
      videoPath: "/tmp/artifacts/video.webm",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];

    expect(args).toContain(resolve("/tmp/artifacts/microphone-before.pcm"));
    expect(args).toContain(resolve("/tmp/artifacts/output-after.pcm"));
    expect(filter).toContain("trim=start=1.300:end=16.300");
    expect(filter).toContain("[1:a]adelay=200:all=1");
    expect(filter).toContain("[4:a]adelay=8300:all=1");
    expect(filter).toContain("MIC INPUT TO EMULATOR - LEFT CHANNEL");
    expect(filter).toContain("RENDERED EMULATOR OUTPUT - RIGHT CHANNEL");
    expect(filter).toContain("concat=n=2:v=1:a=1[video][audio]");
    expect(args).toContain("libx264");
    expect(args).toContain("veryfast");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args).toContain(
      "title=Calibrate microphone input (left) + rendered emulator output (right)"
    );
  });

  it("rejects metadata without synchronized capture segments", () => {
    expect(() =>
      buildAndroidAudioVideoMuxArgs({
        artifactsDir: "/tmp/artifacts",
        metadata: { segments: [] },
        outputPath: "/tmp/artifacts/evidence.mp4",
        videoPath: "/tmp/artifacts/video.webm",
      })
    ).toThrow("has no capture segments");
  });
});
