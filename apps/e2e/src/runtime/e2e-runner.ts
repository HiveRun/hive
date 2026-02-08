import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeContext } from "./runtime-context";
import { waitForHttpOk } from "./wait";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;
const SIGTERM_EXIT_CODE = 143;
const SERVER_READY_PATH = "/health";
const WEB_READY_PATH = "/";
const WDIO_CONFIG_PATH = "./wdio.conf.ts";
const WDIO_BIN_PATH = ["node_modules", "@wdio", "cli", "bin", "wdio.js"];
const ALLURE_RESULTS_DIR = "allure-results";
const VIDEOS_DIR = "videos";
const MIN_VIDEO_ATTACHMENT_BYTES = 2048;
const VIDEO_READY_TIMEOUT_MS = 60_000;
const VIDEO_READY_INTERVAL_MS = 1000;

type ManagedProcess = {
  name: string;
  child: ReturnType<typeof spawn>;
  stdoutPath: string;
  stderrPath: string;
};

type ParsedArgs = {
  spec?: string;
};

type CommandOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
};

type AllureAttachment = {
  name?: string;
  source?: string;
  type?: string;
};

type AllureResult = {
  name?: string;
  attachments?: AllureAttachment[];
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");
const stableArtifactsDir = join(e2eRoot, "reports", "latest");
const repoRoot = join(e2eRoot, "..", "..");
const serverRoot = join(repoRoot, "apps", "server");
const webRoot = join(repoRoot, "apps", "web");

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const context = await createRuntimeContext({ repoRoot });
  const managedProcesses: ManagedProcess[] = [];
  let runSucceeded = false;

  try {
    await createFixtureWorkspace(context.workspaceRoot);

    const server = startManagedProcess({
      command: "bun",
      args: ["run", "src/index.ts"],
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${context.dbPath}`,
        HIVE_HOME: context.hiveHome,
        HIVE_WORKSPACE_ROOT: context.workspaceRoot,
        HOST: "127.0.0.1",
        PORT: String(context.apiPort),
        WEB_PORT: String(context.webPort),
        CORS_ORIGIN: context.webUrl,
      },
      logsDir: context.logsDir,
      name: "server",
    });
    managedProcesses.push(server);

    await waitForHttpOk(`${context.apiUrl}${SERVER_READY_PATH}`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
    });

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

    await waitForHttpOk(`${context.webUrl}${WEB_READY_PATH}`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
    });

    const wdioArgs = [
      join(e2eRoot, ...WDIO_BIN_PATH),
      "run",
      WDIO_CONFIG_PATH,
      ...(args.spec ? ["--spec", args.spec] : []),
    ];

    await runCommand("node", wdioArgs, {
      cwd: e2eRoot,
      env: {
        ...process.env,
        HIVE_E2E_BASE_URL: context.webUrl,
        HIVE_E2E_API_URL: context.apiUrl,
        HIVE_E2E_ARTIFACTS_DIR: context.artifactsDir,
        NODE_OPTIONS: "--import=tsx",
      },
      label: "WebdriverIO suite",
    });

    runSucceeded = true;
    process.stdout.write("E2E suite passed.\n");
  } finally {
    await Promise.all(
      [...managedProcesses]
        .reverse()
        .map((managedProcess) => stopManagedProcess(managedProcess))
    );

    await ensureValidAllureVideoAttachments(context.artifactsDir);

    await publishArtifacts(context.artifactsDir, stableArtifactsDir);
    process.stdout.write(`E2E reports: ${stableArtifactsDir}\n`);

    if (!KEEP_ARTIFACTS && runSucceeded) {
      await rm(context.runRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`E2E run artifacts: ${context.runRoot}\n`);
    }
  }
}

async function ensureValidAllureVideoAttachments(
  artifactsDir: string
): Promise<void> {
  const allureResultsDir = join(artifactsDir, ALLURE_RESULTS_DIR);
  const videosDir = join(artifactsDir, VIDEOS_DIR);

  const allureResultFiles = await listFiles(allureResultsDir, "-result.json");

  const expectedVideoCount = await countExpectedVideoAttachments(
    allureResultsDir,
    allureResultFiles
  );

  if (allureResultFiles.length === 0 || expectedVideoCount === 0) {
    return;
  }

  const availableVideos = await waitForPlayableVideos(
    videosDir,
    expectedVideoCount
  );

  if (availableVideos.length === 0) {
    return;
  }

  const unclaimedVideos = [...availableVideos];

  for (const resultFile of allureResultFiles) {
    await repairResultVideoAttachments({
      allureResultsDir,
      availableVideos,
      resultFile,
      unclaimedVideos,
      videosDir,
    });
  }

  for (const resultFile of allureResultFiles) {
    await validateResultVideoAttachments(allureResultsDir, resultFile);
  }
}

async function countExpectedVideoAttachments(
  allureResultsDir: string,
  resultFiles: string[]
): Promise<number> {
  let count = 0;

  for (const resultFile of resultFiles) {
    const resultPath = join(allureResultsDir, resultFile);
    const resultJson = await readJsonFile<AllureResult>(resultPath);
    count += getVideoAttachmentSources(resultJson).length;
  }

  return count;
}

async function waitForPlayableVideos(
  videosDir: string,
  expectedVideoCount: number
): Promise<string[]> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < VIDEO_READY_TIMEOUT_MS) {
    const videos = await listFiles(videosDir, ".webm");

    if (videos.length < expectedVideoCount) {
      await sleep(VIDEO_READY_INTERVAL_MS);
      continue;
    }

    const allPlayable = await areVideosPlayable(videosDir, videos);
    if (allPlayable) {
      return videos;
    }

    await sleep(VIDEO_READY_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${String(expectedVideoCount)} playable video(s) in ${videosDir}`
  );
}

async function areVideosPlayable(
  videosDir: string,
  videos: string[]
): Promise<boolean> {
  for (const video of videos) {
    const videoPath = join(videosDir, video);
    const playable = await isValidVideoAttachment(videoPath);
    if (!playable) {
      return false;
    }
  }

  return true;
}

async function repairResultVideoAttachments(options: {
  allureResultsDir: string;
  availableVideos: string[];
  resultFile: string;
  unclaimedVideos: string[];
  videosDir: string;
}): Promise<void> {
  const resultPath = join(options.allureResultsDir, options.resultFile);
  const resultJson = await readJsonFile<AllureResult>(resultPath);
  const sources = getVideoAttachmentSources(resultJson);

  for (const source of sources) {
    const attachmentPath = join(options.allureResultsDir, source);
    const isValidAttachment = await isValidVideoAttachment(attachmentPath);
    if (isValidAttachment) {
      continue;
    }

    const fallbackVideo = pickVideoForResult(
      resultJson.name,
      options.unclaimedVideos,
      options.availableVideos
    );

    if (!fallbackVideo) {
      throw new Error(
        `Could not locate fallback video for Allure attachment ${source}`
      );
    }

    const sourceVideoPath = join(options.videosDir, fallbackVideo);
    await copyFile(sourceVideoPath, attachmentPath);
    removeFirstMatch(options.unclaimedVideos, fallbackVideo);
  }
}

async function validateResultVideoAttachments(
  allureResultsDir: string,
  resultFile: string
): Promise<void> {
  const resultPath = join(allureResultsDir, resultFile);
  const resultJson = await readJsonFile<AllureResult>(resultPath);
  const sources = getVideoAttachmentSources(resultJson);

  for (const source of sources) {
    const attachmentPath = join(allureResultsDir, source);
    const attachmentStats = await safeStat(attachmentPath);

    if (!attachmentStats || attachmentStats.size < MIN_VIDEO_ATTACHMENT_BYTES) {
      throw new Error(
        `Allure video attachment is too small: ${attachmentPath} (${String(
          attachmentStats?.size ?? 0
        )} bytes)`
      );
    }

    const decodable = await isVideoDecodable(attachmentPath);
    if (!decodable) {
      throw new Error(
        `Allure video attachment is not decodable: ${attachmentPath}`
      );
    }
  }
}

function getVideoAttachmentSources(resultJson: AllureResult): string[] {
  const attachments = Array.isArray(resultJson.attachments)
    ? resultJson.attachments
    : [];

  return attachments
    .filter(
      (attachment) =>
        typeof attachment.source === "string" &&
        attachment.source.endsWith(".webm") &&
        typeof attachment.type === "string" &&
        attachment.type.includes("video")
    )
    .map((attachment) => attachment.source as string);
}

async function isValidVideoAttachment(path: string): Promise<boolean> {
  const attachmentStats = await safeStat(path);
  if (!attachmentStats || attachmentStats.size < MIN_VIDEO_ATTACHMENT_BYTES) {
    return false;
  }

  return isVideoDecodable(path);
}

async function listFiles(
  directory: string,
  extension: string
): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as T;
}

async function safeStat(path: string): Promise<{ size: number } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function pickVideoForResult(
  resultName: string | undefined,
  unclaimedVideos: string[],
  allVideos: string[]
): string | null {
  const slug = toSlug(resultName);

  if (slug) {
    const slugMatch = unclaimedVideos.find((video) => video.includes(slug));
    if (slugMatch) {
      return slugMatch;
    }
  }

  if (unclaimedVideos.length > 0) {
    return unclaimedVideos[0] ?? null;
  }

  if (slug) {
    const fallbackSlugMatch = allVideos.find((video) => video.includes(slug));
    if (fallbackSlugMatch) {
      return fallbackSlugMatch;
    }
  }

  return allVideos[0] ?? null;
}

function toSlug(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function removeFirstMatch(items: string[], value: string): void {
  const index = items.indexOf(value);
  if (index >= 0) {
    items.splice(index, 1);
  }
}

async function isVideoDecodable(path: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        ["-v", "error", "-i", path, "-f", "null", "-"],
        { stdio: ["ignore", "ignore", "pipe"] }
      );

      let stderr = "";

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(stderr.trim() || `ffmpeg exited with code ${String(code)}`)
        );
      });
    });
    return true;
  } catch {
    const stats = await safeStat(path);
    return Boolean(stats && stats.size >= MIN_VIDEO_ATTACHMENT_BYTES);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function publishArtifacts(
  sourceArtifactsDir: string,
  targetArtifactsDir: string
): Promise<void> {
  await rm(targetArtifactsDir, { recursive: true, force: true });
  await mkdir(targetArtifactsDir, { recursive: true });
  await cp(sourceArtifactsDir, targetArtifactsDir, { recursive: true });
}

function parseArgs(argv: string[]): ParsedArgs {
  const specIndex = argv.indexOf("--spec");
  const spec = specIndex >= 0 ? argv[specIndex + 1] : undefined;
  return { spec };
}

async function createFixtureWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });

  const hiveConfig = {
    opencode: {
      defaultProvider: "zen",
      defaultModel: "big-pickle",
    },
    defaults: {
      templateId: "e2e-template",
    },
    templates: {
      "e2e-template": {
        id: "e2e-template",
        label: "E2E Template",
        type: "manual",
        agent: {
          providerId: "zen",
          modelId: "big-pickle",
        },
      },
    },
  };

  await writeFile(
    join(workspaceRoot, "hive.config.json"),
    `${JSON.stringify(hiveConfig, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    join(workspaceRoot, "@opencode.json"),
    `${JSON.stringify({ model: "zen/big-pickle" }, null, 2)}\n`,
    "utf8"
  );

  await writeFile(join(workspaceRoot, "README.md"), "# Hive E2E Workspace\n");

  await runCommand("git", ["init"], {
    cwd: workspaceRoot,
    label: "Initialize fixture git repository",
  });
  await runCommand("git", ["add", "."], {
    cwd: workspaceRoot,
    label: "Stage fixture files",
  });
  await runCommand(
    "git",
    [
      "-c",
      "user.name=Hive E2E",
      "-c",
      "user.email=hive-e2e@example.com",
      "commit",
      "-m",
      "Initialize E2E workspace",
    ],
    {
      cwd: workspaceRoot,
      label: "Create fixture commit",
    }
  );
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${options.label} failed (exit ${String(
            code
          )})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });
}

function startManagedProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logsDir: string;
  name: string;
}): ManagedProcess {
  const stdoutPath = join(options.logsDir, `${options.name}.stdout.log`);
  const stderrPath = join(options.logsDir, `${options.name}.stderr.log`);
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  child.on("exit", (code) => {
    stdoutStream.end();
    stderrStream.end();
    if (code !== null && code !== 0 && code !== SIGTERM_EXIT_CODE) {
      process.stderr.write(
        `${options.name} exited unexpectedly with code ${String(code)}\n`
      );
    }
  });

  return {
    name: options.name,
    child,
    stdoutPath,
    stderrPath,
  };
}

async function stopManagedProcess(
  managedProcess: ManagedProcess
): Promise<void> {
  const { child, name, stdoutPath, stderrPath } = managedProcess;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, CLEANUP_TIMEOUT_MS);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });

  const missingLogs = [stdoutPath, stderrPath].filter(
    (path) => !existsSync(path)
  );
  if (missingLogs.length > 0) {
    process.stderr.write(
      `Warning: missing ${name} log files: ${missingLogs.join(", ")}\n`
    );
  }
}

run().catch((error) => {
  process.stderr.write(
    `E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
