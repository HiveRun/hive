import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

const OUTPUT_MAX_LINES = 200;
const OUTPUT_HEAD = 80;
const OUTPUT_TAIL = 120;
const LINE_SPLIT_REGEX = /\r?\n/;
const STATUS_PREFIX_REGEX = /^[A-Z?]{1,2}\s+/;
const COMMAND_NEEDS_QUOTES = /[\s"]/;
const NOTIFICATION_EXPIRE_MS = 10_000;
const BIOME_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "astro",
  "json",
  "jsonc",
  "css",
  "scss",
  "md",
  "mdx",
]);

const debug = (..._args: unknown[]) => {
  /* intentional no-op debug helper */
};

type PluginInput = Parameters<Plugin>[0];

type CommandResult = ReturnType<typeof formatResult>;

type IdleCheckDefinition = {
  label: string;
  command: string[];
  useBiomeTargets?: boolean;
};

type IdleValidationSoundConfig = {
  enabled?: unknown;
  command?: unknown;
};

type IdleValidationNotificationConfig = {
  enabled?: unknown;
  sound?: unknown;
};

type IdleValidationConfig = {
  checks?: unknown;
  notification?: unknown;
};

type IdleValidationRawCheck = {
  label?: unknown;
  command?: unknown;
  useBiomeTargets?: unknown;
};

type HandleIdleArgs = {
  $: PluginInput["$"];
  client: PluginInput["client"];
  sessionID: string;
  sessionName: string;
};

let idleChecks: IdleCheckDefinition[] = [];
let idleNotificationsEnabled = true;
let idleSoundEnabled = true;
let idleSoundCommand: string[] | undefined;

const clampOutput = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed.split(LINE_SPLIT_REGEX).map((line) => line.trimEnd());

  if (lines.length <= OUTPUT_MAX_LINES) {
    return lines.join("\n");
  }

  const head = lines.slice(0, OUTPUT_HEAD);
  const tail = lines.slice(-OUTPUT_TAIL);

  return [...head, "…", ...tail].join("\n");
};

const formatResult = (
  label: string,
  command: string,
  output: { exitCode: number; stdout: Buffer; stderr: Buffer }
) => {
  const stdout = output.stdout.toString("utf8");
  const stderr = output.stderr.toString("utf8");
  const combined = clampOutput([stdout, stderr].filter(Boolean).join("\n"));

  return {
    label,
    command,
    exitCode: output.exitCode,
    output: combined,
  };
};

const buildMessage = (
  sessionName: string,
  results: CommandResult[]
): string => {
  const summaryLines = results
    .map((result) => `${result.exitCode === 0 ? "✅" : "❌"} ${result.label}`)
    .join("\n");

  const commandLines = results
    .map(
      (result) =>
        `- ${result.label}: \`${result.command}\` (exit code ${result.exitCode})`
    )
    .join("\n");

  const sections = [
    [
      "[SYSTEM REMINDER - IDLE VALIDATION]",
      "",
      "_Note for the AI assistant (not the user):_",
      "These background checks must pass before this work is considered complete.",
      "Do not treat this as a new user request. Continue the user's existing plan and incorporate these results into your next reply.",
    ].join("\n"),
    `Session: ${sessionName}`,
    `Summary:\n${summaryLines}`,
    `Commands that were run:\n${commandLines}`,
    "You (the human user) should ensure these checks are eventually passing.",
  ];

  return sections.join("\n\n");
};

const stripQuotes = (path: string): string => {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1);
  }

  return path;
};

const isRegularFile = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
};

const normalizePathFromStatus = (line: string): string | undefined => {
  const cleaned = line.replace(STATUS_PREFIX_REGEX, "").trim();
  if (!cleaned) {
    return;
  }

  const candidate = stripQuotes(cleaned.split(" -> ").at(-1)?.trim() ?? "");
  if (!candidate) {
    return;
  }

  return candidate;
};

const gatherChangedFiles = (statusOutput: string): string[] =>
  statusOutput
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePathFromStatus)
    .filter((path): path is string => Boolean(path && isRegularFile(path)));

const isBiomeTarget = (path: string): boolean => {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && BIOME_EXTENSIONS.has(ext));
};

const formatCommandDisplay = (parts: string[]): string =>
  parts
    .map((part) =>
      COMMAND_NEEDS_QUOTES.test(part) ? JSON.stringify(part) : part
    )
    .join(" ");

const notifyIdle = async ($: PluginInput["$"], sessionName: string) => {
  const title = `${sessionName} - Awaiting Input`;
  const summary = `Session ${sessionName} is idle.`;

  try {
    if (idleNotificationsEnabled) {
      await $`notify-send -u normal -t ${NOTIFICATION_EXPIRE_MS} ${title} ${summary}`
        .quiet()
        .nothrow();
    }

    if (idleSoundEnabled && idleSoundCommand && idleSoundCommand.length > 0) {
      const raw = idleSoundCommand.map((part) => $.escape(part)).join(" ");
      await $`${{ raw }}`.quiet().nothrow();
    }
  } catch {
    // ignore notification failures
  }
};

const runCommand = async (
  $: PluginInput["$"],
  label: string,
  parts: string[]
): Promise<CommandResult> => {
  const commandDisplay = formatCommandDisplay(parts);
  const commandRaw = parts.map((part) => $.escape(part)).join(" ");
  debug("running", commandDisplay);
  const output = await $`${{ raw: commandRaw }}`.quiet().nothrow();
  return formatResult(label, commandDisplay, output);
};

const getIdleValidationConfig = (
  rawConfig: unknown
): IdleValidationConfig | undefined => {
  if (!rawConfig || typeof rawConfig !== "object") {
    return;
  }

  return rawConfig as IdleValidationConfig;
};

const parseIdleCheckDefinition = (
  item: unknown
): IdleCheckDefinition | undefined => {
  if (!item || typeof item !== "object") {
    return;
  }

  const raw = item as IdleValidationRawCheck;
  const label = typeof raw.label === "string" ? raw.label.trim() : "";

  const commandRaw = raw.command;
  if (!(label && Array.isArray(commandRaw)) || commandRaw.length === 0) {
    return;
  }

  const command: string[] = [];
  for (const part of commandRaw) {
    if (typeof part === "string" && part.trim().length > 0) {
      command.push(part);
    }
  }

  if (command.length === 0) {
    return;
  }

  const useBiomeTargets = raw.useBiomeTargets === true;

  return { label, command, useBiomeTargets };
};

const parseIdleChecksFromConfig = (
  idleValidation: IdleValidationConfig
): IdleCheckDefinition[] => {
  const checks = idleValidation.checks;

  if (!Array.isArray(checks)) {
    return [];
  }

  const parsed: IdleCheckDefinition[] = [];

  for (const item of checks) {
    const definition = parseIdleCheckDefinition(item);
    if (definition) {
      parsed.push(definition);
    }
  }

  return parsed;
};

const parseBooleanConfig = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const parseSoundCommand = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return;
  }

  const parts: string[] = [];

  for (const part of value) {
    if (typeof part === "string") {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    }
  }

  return parts.length > 0 ? parts : undefined;
};

const applyNotificationSettings = (idleValidation: IdleValidationConfig) => {
  const rawNotification = idleValidation.notification;
  const notification: IdleValidationNotificationConfig =
    rawNotification && typeof rawNotification === "object"
      ? (rawNotification as IdleValidationNotificationConfig)
      : {};

  idleNotificationsEnabled = parseBooleanConfig(notification.enabled, true);

  const rawSound = notification.sound;
  const sound: IdleValidationSoundConfig =
    rawSound && typeof rawSound === "object"
      ? (rawSound as IdleValidationSoundConfig)
      : {};

  idleSoundEnabled = parseBooleanConfig(sound.enabled, true);

  idleSoundCommand = parseSoundCommand(sound.command);

  if (
    idleSoundEnabled &&
    (!idleSoundCommand || idleSoundCommand.length === 0)
  ) {
    throw new Error(
      "Idle validation plugin has notification.sound.enabled=true but no valid notification.sound.command array in its configuration."
    );
  }

  debug("configured idle validation notifications", {
    idleNotificationsEnabled,
    idleSoundEnabled,
    idleSoundCommand,
  });
};

const configureIdleChecksFromConfig = (rawConfig: unknown) => {
  const idleValidation = getIdleValidationConfig(rawConfig);

  if (!idleValidation) {
    throw new Error("Idle validation plugin requires a configuration object.");
  }

  const parsed = parseIdleChecksFromConfig(idleValidation);

  if (parsed.length === 0) {
    throw new Error(
      "Idle validation plugin requires a non-empty 'checks' array in its configuration."
    );
  }

  idleChecks = parsed;

  applyNotificationSettings(idleValidation);

  debug("configured idle validation checks from config", {
    idleChecks,
  });
};

type IdleValidationOutcome =
  | { kind: "clean" }
  | { kind: "noRelevantChanges" }
  | { kind: "passed"; results: CommandResult[] }
  | { kind: "failed"; results: CommandResult[] };

const validateIdleSession = async (
  $: PluginInput["$"],
  _sessionName: string
): Promise<IdleValidationOutcome> => {
  const status = await $`git status --porcelain`.quiet().nothrow();
  const statusOutput = status.stdout.toString("utf8").trim();

  debug("status", statusOutput || "<clean>");

  if (!statusOutput) {
    return { kind: "clean" };
  }

  const changedFiles = gatherChangedFiles(statusOutput);
  debug("changed files", changedFiles);

  if (changedFiles.length === 0) {
    return { kind: "noRelevantChanges" };
  }

  const biomeTargets = changedFiles.filter(isBiomeTarget);
  debug("biome targets", biomeTargets);

  const results: CommandResult[] = [];

  for (const check of idleChecks) {
    if (check.useBiomeTargets) {
      if (biomeTargets.length === 0) {
        continue;
      }

      const parts = [...check.command, ...biomeTargets];
      results.push(await runCommand($, check.label, parts));
      continue;
    }

    results.push(await runCommand($, check.label, check.command));
  }

  if (results.length === 0) {
    return { kind: "noRelevantChanges" };
  }

  const hasFailure = results.some((result) => result.exitCode !== 0);
  if (!hasFailure) {
    return { kind: "passed", results };
  }

  return { kind: "failed", results };
};

const handleIdle = async ({
  $,
  client,
  sessionID,
  sessionName,
}: HandleIdleArgs) => {
  const outcome = await validateIdleSession($, sessionName);

  if (outcome.kind === "failed") {
    const message = buildMessage(sessionName, outcome.results);

    await client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [
          {
            type: "text",
            text: message,
          },
        ],
      },
    });

    return;
  }

  await notifyIdle($, sessionName);
};

const loadIdleValidationConfig = (directory: string): IdleValidationConfig => {
  const configPath = join(
    directory,
    ".opencode",
    "plugin",
    "idle-validate.json"
  );

  if (!(existsSync(configPath) && statSync(configPath).isFile())) {
    throw new Error(
      "Idle validation plugin requires .opencode/plugin/idle-validate.json configuration file."
    );
  }

  const content = readFileSync(configPath, "utf8");

  try {
    return JSON.parse(content) as IdleValidationConfig;
  } catch (error) {
    const cause = error as Error;
    throw new Error(
      `Failed to parse .opencode/plugin/idle-validate.json: ${cause.message}`
    );
  }
};

export const IdleValidate: Plugin = ({ $, client, directory }) => {
  const sessionName = basename(directory).trim() || "Session";
  let running = false;

  configureIdleChecksFromConfig(loadIdleValidationConfig(directory));

  return Promise.resolve({
    event: async ({ event }) => {
      if (event.type !== "session.idle" || running) {
        return;
      }

      const sessionID = (event as { properties?: { sessionID?: string } })
        .properties?.sessionID;
      if (!sessionID) {
        return;
      }

      running = true;

      try {
        await handleIdle({ $, client, sessionID, sessionName });
      } catch (error) {
        debug("failure", error);

        if (idleNotificationsEnabled) {
          await $`notify-send -u normal -t ${NOTIFICATION_EXPIRE_MS} ${sessionName} "Idle checks plugin failed"`
            .quiet()
            .nothrow();
        }

        if (
          idleSoundEnabled &&
          idleSoundCommand &&
          idleSoundCommand.length > 0
        ) {
          const raw = idleSoundCommand.map((part) => $.escape(part)).join(" ");
          await $`${{ raw }}`.quiet().nothrow();
        }
      } finally {
        running = false;
      }
    },
  });
};
