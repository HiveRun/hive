import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

const OUTPUT_MAX_LINES = 200;
const OUTPUT_HEAD = 80;
const OUTPUT_TAIL = 120;
const LINE_SPLIT_REGEX = /\r?\n/;
const STATUS_PREFIX_REGEX = /^[A-Z?]{1,2}\s+/;
const COMMAND_NEEDS_QUOTES = /[\s"]/;
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

type HandleIdleArgs = {
  $: PluginInput["$"];
  client: PluginInput["client"];
  sessionID: string;
  sessionName: string;
};

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
  const summary = results
    .map((result) => `${result.exitCode === 0 ? "✅" : "❌"} ${result.label}`)
    .join("\n");

  const details = results
    .filter((result) => result.exitCode !== 0)
    .map((result) => {
      const body =
        result.output.length > 0
          ? `\n\n\`\`\`\n${result.output}\n\`\`\``
          : "\n\n_No output captured._";

      return `### ${result.label}\nCommand: \`${result.command}\`\nExit code: ${result.exitCode}${body}`;
    })
    .join("\n\n");

  const sections = [
    `Idle validation detected failures in ${sessionName}.`,
    `Summary:\n${summary}`,
  ];

  if (details.length > 0) {
    sections.push(details);
  }

  sections.push(
    "Please resolve the failing checks and re-run them until they succeed."
  );

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
    await $`notify-send -u normal -t 0 ${title} ${summary}`.quiet().nothrow();
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

const handleIdle = async ({
  $,
  client,
  sessionID,
  sessionName,
}: HandleIdleArgs) => {
  const status = await $`git status --porcelain`.quiet().nothrow();
  const statusOutput = status.stdout.toString("utf8").trim();

  debug("status", statusOutput || "<clean>");

  if (!statusOutput) {
    await notifyIdle($, sessionName);
    return;
  }

  const changedFiles = gatherChangedFiles(statusOutput);
  debug("changed files", changedFiles);

  if (changedFiles.length === 0) {
    await notifyIdle($, sessionName);
    return;
  }

  const biomeTargets = changedFiles.filter(isBiomeTarget);
  debug("biome targets", biomeTargets);

  const results: CommandResult[] = [];

  if (biomeTargets.length > 0) {
    const biomeParts = [
      "bunx",
      "biome",
      "check",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
      ...biomeTargets,
    ];

    results.push(await runCommand($, "Biome lint", biomeParts));
  }

  const typeCheckResult = await runCommand($, "TypeScript check", [
    "bun",
    "run",
    "check-types",
  ]);
  results.push(typeCheckResult);

  const hasFailure = results.some((result) => result.exitCode !== 0);
  if (!hasFailure) {
    await notifyIdle($, sessionName);
    return;
  }

  const message = buildMessage(sessionName, results);

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
};

export const IdleValidate: Plugin = ({ $, client, directory }) => {
  const sessionName = basename(directory).trim() || "Session";
  let running = false;

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
        await $`notify-send -u normal ${sessionName} "Idle checks plugin failed"`
          .quiet()
          .nothrow();
      } finally {
        running = false;
      }
    },
  });
};
