import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const androidAudioVideoMetadataFilename = "android-audio-video.json";
const androidAudioVideoFilename = "android-service-audio-evidence.mp4";
const audioSampleRate = "48000";
const millisecondsPerSecond = 1000;
const timestampPrecision = 3;
const syncSlateSamplesPerSecond = 100;
const rgbChannelCount = 3;
const syncSlateBrightThreshold = 240;
const syncSlateDarkThreshold = 20;

type AndroidAudioVideoSegment = {
  label: string;
  microphonePcm: string;
  microphoneActiveDurationMs: number;
  microphoneActiveOffsetMs: number;
  microphoneOffsetMs: number;
  outputPcm: string;
  outputActiveDurationMs: number;
  outputActiveOffsetMs: number;
  outputOffsetMs: number;
  videoEndMs: number;
  videoStartMs: number;
};

export type AndroidAudioVideoMetadata = {
  segments: AndroidAudioVideoSegment[];
};

const findPlaywrightVideo = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findPlaywrightVideo(path);
      }
      return Promise.resolve(entry.name === "video.webm" ? [path] : []);
    })
  );
  return matches.flat();
};

const seconds = (milliseconds: number) =>
  (milliseconds / millisecondsPerSecond).toFixed(timestampPrecision);

const drawText = (options: {
  color: string;
  enable?: string;
  text: string;
  y: string;
}) => {
  const enable = options.enable ? `:enable='${options.enable}'` : "";
  return `drawtext=text='${options.text}':fontcolor=${options.color}:fontsize=34:box=1:boxcolor=black@0.78:boxborderw=16:x=40:y=${options.y}${enable}`;
};

export const buildAndroidAudioVideoMuxArgs = (options: {
  artifactsDir: string;
  metadata: AndroidAudioVideoMetadata;
  outputPath: string;
  timelineOffsetMs?: number;
  videoPath: string;
}): string[] => {
  if (options.metadata.segments.length === 0) {
    throw new Error("Android audio video metadata has no capture segments.");
  }
  const args = ["-y", "-i", options.videoPath];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  const timelineOffsetMs = options.timelineOffsetMs ?? 0;

  for (const [index, segment] of options.metadata.segments.entries()) {
    if (segment.videoEndMs <= segment.videoStartMs) {
      throw new Error(`Android audio video segment ${index} has no duration.`);
    }
    const microphoneInput = index * 2 + 1;
    const outputInput = microphoneInput + 1;
    args.push(
      "-f",
      "s16le",
      "-ar",
      audioSampleRate,
      "-ac",
      "1",
      "-i",
      resolve(options.artifactsDir, segment.microphonePcm),
      "-f",
      "s16le",
      "-ar",
      audioSampleRate,
      "-ac",
      "1",
      "-i",
      resolve(options.artifactsDir, segment.outputPcm)
    );

    const videoStartMs = segment.videoStartMs + timelineOffsetMs;
    const videoEndMs = segment.videoEndMs + timelineOffsetMs;
    const durationMs = videoEndMs - videoStartMs;
    const duration = seconds(durationMs);
    const microphoneDelay = Math.max(
      0,
      segment.microphoneOffsetMs - segment.videoStartMs
    );
    const outputDelay = Math.max(
      0,
      segment.outputOffsetMs - segment.videoStartMs
    );
    const microphoneActiveStart = Math.max(
      0,
      segment.microphoneActiveOffsetMs - segment.videoStartMs
    );
    const outputActiveStart = Math.max(
      0,
      segment.outputActiveOffsetMs - segment.videoStartMs
    );
    const microphoneEnabled = `between(t\\,${seconds(microphoneActiveStart)}\\,${seconds(microphoneActiveStart + segment.microphoneActiveDurationMs)})`;
    const outputEnabled = `between(t\\,${seconds(outputActiveStart)}\\,${seconds(outputActiveStart + segment.outputActiveDurationMs)})`;
    const videoFilters = [
      `[0:v]trim=start=${seconds(videoStartMs)}:end=${seconds(videoEndMs)},setpts=PTS-STARTPTS`,
      drawText({
        color: "white",
        text: segment.label,
        y: "40",
      }),
      drawText({
        color: "0xF5A524",
        enable: microphoneEnabled,
        text: "MIC INPUT TO EMULATOR - LEFT CHANNEL",
        y: "h-th-40",
      }),
      drawText({
        color: "0x2DD4BF",
        enable: outputEnabled,
        text: "RENDERED EMULATOR OUTPUT - RIGHT CHANNEL",
        y: "h-th-40",
      }),
    ];
    filters.push(
      `${videoFilters.join(",")}[video${index}]`,
      `[${microphoneInput}:a]adelay=${microphoneDelay}:all=1,apad,atrim=duration=${duration}[microphone${index}]`,
      `[${outputInput}:a]adelay=${outputDelay}:all=1,apad,atrim=duration=${duration}[output${index}]`,
      `[microphone${index}][output${index}]join=inputs=2:channel_layout=stereo[audio${index}]`
    );
    concatInputs.push(`[video${index}][audio${index}]`);
  }

  filters.push(
    `${concatInputs.join("")}concat=n=${options.metadata.segments.length}:v=1:a=1[video][audio]`
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[video]",
    "-map",
    "[audio]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-metadata:s:a:0",
    "title=Calibrate microphone input (left) + rendered emulator output (right)",
    "-movflags",
    "+faststart",
    options.outputPath
  );
  return args;
};

const findSyncSlateOffsetMs = async (videoPath: string) => {
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      `fps=${syncSlateSamplesPerSecond},format=rgb24,crop=1:1:0:0`,
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not locate Android evidence sync slate: ${stderr}`);
  }
  const pixels = new Uint8Array(stdout);
  for (
    let offset = 0;
    offset + rgbChannelCount <= pixels.length;
    offset += rgbChannelCount
  ) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    if (
      red > syncSlateBrightThreshold &&
      green < syncSlateDarkThreshold &&
      blue > syncSlateBrightThreshold
    ) {
      return Math.round(
        (offset / rgbChannelCount / syncSlateSamplesPerSecond) *
          millisecondsPerSecond
      );
    }
  }
  throw new Error(
    "Android evidence video does not contain the magenta sync slate."
  );
};

export const prepareAndroidAudioVideoMux = async (
  artifactsDir: string
): Promise<{
  args: string[];
  expectedDurationMs: number;
  outputPath: string;
  segmentDurationsMs: number[];
}> => {
  const metadata = JSON.parse(
    await readFile(
      join(artifactsDir, androidAudioVideoMetadataFilename),
      "utf8"
    )
  ) as AndroidAudioVideoMetadata;
  const videos = await findPlaywrightVideo(join(artifactsDir, "test-results"));
  const videoPath = videos[0];
  if (videos.length !== 1 || !videoPath) {
    throw new Error(
      `Expected one Android Playwright video, found ${videos.length}.`
    );
  }
  const outputPath = join(artifactsDir, androidAudioVideoFilename);
  const timelineOffsetMs = await findSyncSlateOffsetMs(videoPath);
  return {
    args: buildAndroidAudioVideoMuxArgs({
      artifactsDir,
      metadata,
      outputPath,
      timelineOffsetMs,
      videoPath,
    }),
    expectedDurationMs: metadata.segments.reduce(
      (total, segment) => total + segment.videoEndMs - segment.videoStartMs,
      0
    ),
    outputPath,
    segmentDurationsMs: metadata.segments.map(
      (segment) => segment.videoEndMs - segment.videoStartMs
    ),
  };
};
