import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ProviderMetadata, sortProviderIds } from "./provider-metadata";

const WORKSPACE_CONFIG_CANDIDATES = [
  "@opencode.json",
  "opencode.json",
] as const;
const CLI_ARGS = ["debug", "config"] as const;
const BUNX_COMMAND = ["bunx", "--bun", "opencode"] as const;
const NEWLINE_REGEX = /\r?\n/;

export type LoadedOpencodeConfig = {
  config: Record<string, unknown>;
  source: "cli" | "workspace" | "default";
  details?: string;
};

export async function loadOpencodeConfig(
  workspaceRootPath: string
): Promise<LoadedOpencodeConfig> {
  const cliConfig = await loadConfigFromCli(workspaceRootPath);
  if (cliConfig) {
    return cliConfig;
  }

  const fileConfig = await readWorkspaceConfig(workspaceRootPath);
  if (fileConfig) {
    return { config: fileConfig, source: "workspace" };
  }

  return { config: {}, source: "default" };
}

export type OpencodeModelInfo = {
  providerId: string;
  modelId: string;
  key: string;
  name: string;
  metadata?: Record<string, unknown>;
};

export type OpencodeModelCatalog = {
  models: OpencodeModelInfo[];
  defaults: Record<string, string>;
  providers: ProviderMetadata[];
};

export async function fetchOpencodeModels(
  workspaceRootPath: string
): Promise<OpencodeModelCatalog> {
  const verboseResult = await runOpencodeCommand(
    ["models", "--verbose"],
    workspaceRootPath
  ).catch((): CliCommandResult | null => null);

  if (verboseResult) {
    const parsed = parseVerboseModels(verboseResult.stdout);
    if (parsed.models.length > 0) {
      return withProviderMetadata(parsed);
    }
  }

  const basicResult = await runOpencodeCommand(["models"], workspaceRootPath);
  return withProviderMetadata(parseBasicModels(basicResult.stdout));
}

async function readWorkspaceConfig(
  workspaceRootPath: string
): Promise<Record<string, unknown> | undefined> {
  for (const filename of WORKSPACE_CONFIG_CANDIDATES) {
    const configPath = join(workspaceRootPath, filename);
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        continue;
      }
      throw new Error(
        `Failed to read OpenCode config from ${configPath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  return;
}

let hasLoggedCliFailure = false;

async function loadConfigFromCli(
  workspaceRootPath: string
): Promise<LoadedOpencodeConfig | undefined> {
  try {
    const result = await runOpencodeCommand([...CLI_ARGS], workspaceRootPath);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    return { config: parsed, source: "cli", details: result.label };
  } catch (error) {
    if (!hasLoggedCliFailure) {
      hasLoggedCliFailure = true;
      // biome-ignore lint/suspicious/noConsole: surfaced for debugging when CLI config fails
      console.warn(
        `[opencode] Falling back to workspace config. Failed to load merged config via CLI: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return;
}

type CommandCandidate = {
  cmd: string[];
  label: string;
};

type CliCommandResult = {
  stdout: string;
  label: string;
};

async function runOpencodeCommand(
  args: string[],
  workspaceRootPath: string
): Promise<CliCommandResult> {
  const errors: string[] = [];
  for (const candidate of createCommandCandidates()) {
    try {
      const stdout = await runCommand(
        [...candidate.cmd, ...args],
        workspaceRootPath
      );
      return { stdout, label: candidate.label };
    } catch (error) {
      errors.push(
        `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error(errors.join(", "));
}

function createCommandCandidates(): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  const custom = process.env.HIVE_OPENCODE_BIN;
  if (custom) {
    candidates.push({ cmd: custom.split(" ").filter(Boolean), label: custom });
  }

  candidates.push({ cmd: ["opencode"], label: "opencode" });
  candidates.push({ cmd: [...BUNX_COMMAND], label: BUNX_COMMAND.join(" ") });
  return candidates;
}

async function runCommand(cmd: string[], cwd: string): Promise<string> {
  let subprocess: ReturnType<typeof Bun.spawn>;
  try {
    subprocess = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    throw new Error(
      `Failed to start '${cmd.join(" ")}'${error instanceof Error ? `: ${error.message}` : ""}`
    );
  }

  const stdoutStream =
    typeof subprocess.stdout === "number" ? null : subprocess.stdout;
  const stderrStream =
    typeof subprocess.stderr === "number" ? null : subprocess.stderr;

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(stdoutStream),
    readStream(stderrStream),
    subprocess.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`
    );
  }

  return stdout.trim();
}

function readStream(
  stream: ReadableStream | null | undefined
): Promise<string> {
  if (!stream) {
    return Promise.resolve("");
  }
  const response = new Response(stream);
  return response.text();
}

function parseVerboseModels(output: string) {
  const models: OpencodeModelInfo[] = [];
  const defaults: Record<string, string> = {};
  const lines = output.split(NEWLINE_REGEX);
  let currentKey: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentKey || buffer.length === 0) {
      currentKey = null;
      buffer = [];
      return;
    }
    const [providerId, modelId] = currentKey.split("/", 2);
    if (!(providerId && modelId)) {
      currentKey = null;
      buffer = [];
      return;
    }
    try {
      const metadata = JSON.parse(buffer.join("\n")) as Record<string, unknown>;
      const entry: OpencodeModelInfo = {
        providerId,
        modelId,
        key: currentKey,
        name: (metadata.name as string) ?? modelId,
        metadata,
      };
      models.push(entry);
      if (!defaults[providerId]) {
        defaults[providerId] = modelId;
      }
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: best-effort parsing of CLI output
      console.warn(
        `[opencode] Failed to parse verbose model metadata for ${currentKey}: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      currentKey = null;
      buffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      flush();
      currentKey = trimmed;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return { models, defaults };
}

function parseBasicModels(output: string) {
  const models: OpencodeModelInfo[] = [];
  const defaults: Record<string, string> = {};
  const lines = output.split(NEWLINE_REGEX);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!trimmed.includes("/")) {
      continue;
    }
    const [providerId, modelId] = trimmed.split("/", 2);
    if (!(providerId && modelId)) {
      continue;
    }
    models.push({
      providerId,
      modelId,
      key: trimmed,
      name: modelId,
    });
    if (!defaults[providerId]) {
      defaults[providerId] = modelId;
    }
  }

  return { models, defaults };
}

function withProviderMetadata(result: {
  models: OpencodeModelInfo[];
  defaults: Record<string, string>;
}): OpencodeModelCatalog {
  const providerIds = result.models.map((model) => model.providerId);
  const providers = sortProviderIds(providerIds);
  return {
    models: result.models,
    defaults: result.defaults,
    providers,
  };
}
