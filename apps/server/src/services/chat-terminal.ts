import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "../config/runtime-env";

import { type IPty, spawn } from "bun-pty";
import type { AgentMode } from "../agents/types";
import {
  allowsEmbeddedChatControlInput,
  mergeHiveEmbeddedBrowserSafeKeybinds,
  normalizeOpencodeKeybinds,
} from "../opencode/browser-safe-keybinds";
import {
  createPtySessionController,
  createTerminalRecordFields,
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  type PtyTerminalProcess,
  type TerminalEvent,
  type TerminalRecordFields,
  type TerminalSessionFields,
  type TerminalSessionService,
  toTerminalSession,
  trimTerminalOutput,
} from "./terminal-store";

const MAX_TERMINAL_BUFFER_CHARS = 2_000_000;
const BUFFER_RETAIN_CHARS = 1_600_000;
const TERMINAL_RESET_SEQUENCE = "\x1bc";
const TERMINAL_NAME = "xterm-256color";
const INSTALL_HINT = "curl -fsSL https://opencode.ai/install | bash";
const HIVE_THEME_NAME = "hive-resonant";
const DEFAULT_THEME_MODE = "dark";
const ASCII_END_OF_TEXT = "\u0003";
const ASCII_END_OF_TRANSMISSION = "\u0004";
const PLAN_MODE_SWITCH_RETRY_MS = 2000;
const WORKSPACE_CONFIG_CANDIDATES = [
  "@opencode.json",
  "opencode.json",
] as const;

type ChatTerminalModelPreference = {
  providerId: string;
  modelId: string;
  variant?: string;
};

const HIVE_THEME_CONTENT = `${JSON.stringify(
  {
    $schema: "https://opencode.ai/theme.json",
    defs: {
      obsidian: "#070504",
      graphite: "#15110E",
      basalt: "#241C17",
      amber: "#F5A524",
      honey: "#FFC857",
      signal: "#FF8F1F",
      pollen: "#FFE9A8",
      teal: "#2DD4BF",
      violet: "#7C5BFF",
      magma: "#FF5C5C",
      chlorophyll: "#8EDB5D",
      soot: "#0F0B09",
      fog: "#C4B89F",
      steel: "#8A7A63",
      ivory: "#F4E6CD",
      daylight: "#F6F1E6",
      parchment: "#EFE5CF",
      ink: "#2B2520",
    },
    theme: {
      primary: { dark: "amber", light: "signal" },
      secondary: { dark: "amber", light: "amber" },
      accent: { dark: "honey", light: "signal" },
      error: { dark: "magma", light: "magma" },
      warning: { dark: "signal", light: "signal" },
      success: { dark: "chlorophyll", light: "chlorophyll" },
      info: { dark: "honey", light: "violet" },
      text: { dark: "ivory", light: "ink" },
      textMuted: { dark: "fog", light: "steel" },
      background: { dark: "obsidian", light: "daylight" },
      backgroundPanel: { dark: "graphite", light: "parchment" },
      backgroundElement: { dark: "basalt", light: "parchment" },
      backgroundMenu: { dark: "graphite", light: "parchment" },
      border: { dark: "#4A382C", light: "#C7BDA6" },
      borderActive: { dark: "amber", light: "signal" },
      borderSubtle: { dark: "#33271F", light: "#D9D0BD" },
      diffAdded: { dark: "teal", light: "#2F7D4A" },
      diffRemoved: { dark: "magma", light: "#B93D3D" },
      diffContext: { dark: "fog", light: "#766C60" },
      diffHunkHeader: { dark: "honey", light: "amber" },
      diffHighlightAdded: { dark: "chlorophyll", light: "#2F7D4A" },
      diffHighlightRemoved: { dark: "magma", light: "#B93D3D" },
      diffAddedBg: { dark: "#12352D", light: "#DDEDD9" },
      diffRemovedBg: { dark: "#3D1717", light: "#F3D9D8" },
      diffContextBg: { dark: "graphite", light: "daylight" },
      diffLineNumber: { dark: "steel", light: "steel" },
      diffAddedLineNumberBg: { dark: "#164439", light: "#D5E8D0" },
      diffRemovedLineNumberBg: { dark: "#4A1E1E", light: "#EED1D0" },
      markdownText: { dark: "ivory", light: "ink" },
      markdownHeading: { dark: "honey", light: "signal" },
      markdownLink: { dark: "honey", light: "#2A7D86" },
      markdownLinkText: { dark: "pollen", light: "#A35D11" },
      markdownCode: { dark: "honey", light: "#A35D11" },
      markdownBlockQuote: { dark: "steel", light: "steel" },
      markdownEmph: { dark: "signal", light: "signal" },
      markdownStrong: { dark: "amber", light: "signal" },
      markdownHorizontalRule: { dark: "basalt", light: "#D9D0BD" },
      markdownListItem: { dark: "amber", light: "signal" },
      markdownListEnumeration: { dark: "honey", light: "amber" },
      markdownImage: { dark: "honey", light: "#2A7D86" },
      markdownImageText: { dark: "pollen", light: "#A35D11" },
      markdownCodeBlock: { dark: "ivory", light: "ink" },
      syntaxComment: { dark: "steel", light: "steel" },
      syntaxKeyword: { dark: "signal", light: "signal" },
      syntaxFunction: { dark: "honey", light: "amber" },
      syntaxVariable: { dark: "ivory", light: "#4A3D2D" },
      syntaxString: { dark: "chlorophyll", light: "#2F7D4A" },
      syntaxNumber: { dark: "honey", light: "violet" },
      syntaxType: { dark: "amber", light: "signal" },
      syntaxOperator: { dark: "steel", light: "#6A6359" },
      syntaxPunctuation: { dark: "fog", light: "#7B7368" },
      thinkingOpacity: 0.9,
    },
  },
  null,
  2
)}\n`;

function parseJsonRecord(content: string | undefined): Record<string, unknown> {
  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed persisted state payloads
  }

  return {};
}

function readWorkspaceKeybinds(workspacePath: string): Record<string, string> {
  for (const candidate of WORKSPACE_CONFIG_CANDIDATES) {
    const configPath = join(workspacePath, candidate);
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const rawConfig = readFileSync(configPath, "utf8");
      const parsedConfig = parseJsonRecord(rawConfig);
      return normalizeOpencodeKeybinds(parsedConfig.keybinds);
    } catch {
      // ignore unreadable workspace config candidates and continue
    }
  }

  return {};
}

function toOpencodeModelValue(
  preference: ChatTerminalModelPreference | undefined
): string | undefined {
  if (!preference) {
    return;
  }

  if (preference.modelId.includes("/")) {
    return preference.modelId;
  }

  return `${preference.providerId}/${preference.modelId}`;
}

const isEmbeddedControlInput = (data: string): boolean =>
  data === ASCII_END_OF_TEXT || data === ASCII_END_OF_TRANSMISSION;

type MergedInlineOpencodeConfig = {
  config: Record<string, unknown>;
  allowEmbeddedControlInput: boolean;
};

const normalizeStartMode = (
  value: string | undefined
): AgentMode | undefined =>
  value === "plan" || value === "build" ? value : undefined;

function createMergedInlineOpencodeConfig(
  workspacePath: string,
  preferredModel?: ChatTerminalModelPreference,
  startMode?: AgentMode
): MergedInlineOpencodeConfig {
  const inlineConfig = parseJsonRecord(process.env.OPENCODE_CONFIG_CONTENT);
  const workspaceKeybinds = readWorkspaceKeybinds(workspacePath);
  const inlineKeybinds = normalizeOpencodeKeybinds(inlineConfig.keybinds);
  const model = toOpencodeModelValue(preferredModel);
  const configuredStartMode =
    startMode ??
    (typeof inlineConfig.default_agent === "string"
      ? normalizeStartMode(inlineConfig.default_agent)
      : undefined);
  const keybinds = mergeHiveEmbeddedBrowserSafeKeybinds(
    workspaceKeybinds,
    inlineKeybinds
  );
  const agentConfig =
    preferredModel?.variant && configuredStartMode
      ? {
          ...((inlineConfig.agent as Record<string, unknown> | undefined) ??
            {}),
          [configuredStartMode]: {
            ...(((
              inlineConfig.agent as
                | Record<string, Record<string, unknown>>
                | undefined
            )?.[configuredStartMode] ?? {}) as Record<string, unknown>),
            variant: preferredModel.variant,
          },
        }
      : inlineConfig.agent;
  const config = {
    ...inlineConfig,
    ...(model ? { model } : {}),
    ...(configuredStartMode ? { default_agent: configuredStartMode } : {}),
    ...(agentConfig ? { agent: agentConfig } : {}),
    keybinds,
    theme: HIVE_THEME_NAME,
  };

  return {
    config,
    allowEmbeddedControlInput: allowsEmbeddedChatControlInput(keybinds),
  };
}

function createOpencodeThemeEnv(
  workspacePath: string,
  themeMode: "dark" | "light",
  mergedInlineConfig: Record<string, unknown>
): Record<string, string> {
  const configRoot = join(workspacePath, ".opencode");
  const themeDir = join(configRoot, "themes");
  const themePath = join(themeDir, `${HIVE_THEME_NAME}.json`);
  const stateHome = join(configRoot, "state");
  const stateDir = join(stateHome, "opencode");
  const kvPath = join(stateDir, "kv.json");
  const env: Record<string, string> = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(mergedInlineConfig),
    OPENCODE_EXPERIMENTAL_PLAN_MODE: "1",
  };

  try {
    mkdirSync(themeDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const existingTheme = existsSync(themePath)
      ? readFileSync(themePath, "utf8")
      : null;
    if (existingTheme !== HIVE_THEME_CONTENT) {
      writeFileSync(themePath, HIVE_THEME_CONTENT, "utf8");
    }

    const existingKv = existsSync(kvPath)
      ? readFileSync(kvPath, "utf8")
      : undefined;
    const kvRecord = parseJsonRecord(existingKv);
    if (
      kvRecord.theme !== HIVE_THEME_NAME ||
      kvRecord.theme_mode !== themeMode
    ) {
      writeFileSync(
        kvPath,
        JSON.stringify(
          {
            ...kvRecord,
            theme: HIVE_THEME_NAME,
            theme_mode: themeMode,
          },
          null,
          2
        ),
        "utf8"
      );
    }

    env.XDG_STATE_HOME = stateHome;
  } catch {
    // proceed without custom Hive theme artifacts
  }

  return env;
}

export type ChatTerminalSession = TerminalSessionFields & {
  cellId: string;
};

export type ChatTerminalEvent = TerminalEvent;

type ChatTerminalRecord = TerminalRecordFields & {
  cellId: string;
  pty: IPty;
  opencodeSessionId: string;
  opencodeServerUrl: string;
  opencodeThemeMode: "dark" | "light";
  preferredModel?: string;
  startMode?: AgentMode;
  allowEmbeddedControlInput: boolean;
};

type ChatTerminalService = TerminalSessionService<
  ChatTerminalSession,
  ChatTerminalEvent
> & {
  ensureSession(args: {
    cellId: string;
    workspacePath: string;
    opencodeSessionId: string;
    opencodeServerUrl: string;
    opencodeThemeMode?: "dark" | "light";
    preferredModel?: ChatTerminalModelPreference;
    startMode?: AgentMode;
  }): ChatTerminalSession;
};

const toSession = (record: ChatTerminalRecord): ChatTerminalSession =>
  toTerminalSession(record, { cellId: record.cellId });

const appendBuffer = (current: string, chunk: string): string =>
  trimTerminalOutput(current, chunk, {
    maxChars: MAX_TERMINAL_BUFFER_CHARS,
    retainChars: BUFFER_RETAIN_CHARS,
    resetSequence: TERMINAL_RESET_SEQUENCE,
  });

const TERMINAL_MODE_STATUS_PATTERN = /\b(Plan|Build)\b[\s\S]{0,120}OpenCode/g;

function extractTerminalMode(buffer: string): AgentMode | undefined {
  const matches = [...buffer.matchAll(TERMINAL_MODE_STATUS_PATTERN)];
  const latest = matches.at(-1)?.[1];
  if (latest === "Plan") {
    return "plan";
  }
  if (latest === "Build") {
    return "build";
  }
  return;
}

function schedulePlanModeSwitch(record: ChatTerminalRecord): void {
  if (record.startMode !== "plan") {
    return;
  }

  const pollIntervalMs = 300;
  const timeoutMs = 12_000;
  let tabSentAt: number | null = null;
  const startedAt = Date.now();

  const attemptSwitch = () => {
    if (record.status !== "running") {
      return;
    }

    const mode = extractTerminalMode(record.output);
    if (mode === "plan") {
      return;
    }

    const now = Date.now();
    if (now - startedAt >= timeoutMs) {
      return;
    }

    if (mode === "build" && tabSentAt === null) {
      record.pty.write("\t");
      tabSentAt = now;
    }

    if (
      mode === "build" &&
      tabSentAt !== null &&
      now - tabSentAt >= PLAN_MODE_SWITCH_RETRY_MS
    ) {
      record.pty.write("\t");
      tabSentAt = now;
    }

    setTimeout(() => {
      attemptSwitch();
    }, pollIntervalMs);
  };

  setTimeout(attemptSwitch, pollIntervalMs);
}

const createChannel = (cellId: string): string => `chat:${cellId}`;

const resolveOpencodeBinary = (): string => {
  const configured = process.env.HIVE_OPENCODE_BIN?.trim();
  return configured && configured.length > 0 ? configured : "opencode";
};

const createSpawnErrorMessage = (binary: string, error: unknown): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return `Failed to start OpenCode chat terminal using '${binary}'. ${reason}. Install OpenCode with '${INSTALL_HINT}' or set HIVE_OPENCODE_BIN to the executable path.`;
};

type ChatTerminalEnsureArgs = Parameters<
  ChatTerminalService["ensureSession"]
>[0];

const prepareChatTerminalSpawn = ({
  workspacePath,
  opencodeServerUrl,
  opencodeSessionId,
  opencodeThemeMode = DEFAULT_THEME_MODE,
  preferredModel,
  startMode,
}: ChatTerminalEnsureArgs) => {
  const normalizedStartMode = normalizeStartMode(startMode);
  const mergedInlineConfig = createMergedInlineOpencodeConfig(
    workspacePath,
    preferredModel,
    normalizedStartMode
  );

  return {
    normalizedStartMode,
    preferredModelValue: toOpencodeModelValue(preferredModel),
    opencodeThemeMode,
    allowEmbeddedControlInput: mergedInlineConfig.allowEmbeddedControlInput,
    spawnOptions: {
      args: [
        "attach",
        opencodeServerUrl,
        "--dir",
        workspacePath,
        "--session",
        opencodeSessionId,
      ],
      env: createOpencodeThemeEnv(
        workspacePath,
        opencodeThemeMode,
        mergedInlineConfig.config
      ),
    },
  };
};

const createChatTerminalService = (): ChatTerminalService => {
  const controller = createPtySessionController<
    ChatTerminalEnsureArgs,
    ChatTerminalRecord,
    ChatTerminalSession
  >({
    channelForId: createChannel,
    trimOutput: appendBuffer,
    spawnPty: (args) => {
      const opencodeBinary = resolveOpencodeBinary();
      const prepared = prepareChatTerminalSpawn(args);
      try {
        return spawn(opencodeBinary, prepared.spawnOptions.args, {
          name: TERMINAL_NAME,
          cols: DEFAULT_TERMINAL_COLS,
          rows: DEFAULT_TERMINAL_ROWS,
          cwd: args.workspacePath,
          env: {
            ...process.env,
            ...prepared.spawnOptions.env,
            TERM: TERMINAL_NAME,
            COLORTERM: process.env.COLORTERM ?? "truecolor",
          },
        }) as PtyTerminalProcess;
      } catch (error) {
        throw new Error(createSpawnErrorMessage(opencodeBinary, error));
      }
    },
    createRecord: (args, pty) => {
      const prepared = prepareChatTerminalSpawn(args);
      return {
        ...createTerminalRecordFields(
          `chat_terminal_${crypto.randomUUID()}`,
          args.workspacePath,
          {
            pid: pty.pid,
            kill: () => pty.kill(),
            resize: (cols, rows) => pty.resize(cols, rows),
            write: (data) => pty.write(data),
          }
        ),
        cellId: args.cellId,
        pty: pty as IPty,
        opencodeSessionId: args.opencodeSessionId,
        opencodeServerUrl: args.opencodeServerUrl,
        opencodeThemeMode: prepared.opencodeThemeMode,
        preferredModel: prepared.preferredModelValue,
        startMode: prepared.normalizedStartMode,
        allowEmbeddedControlInput: prepared.allowEmbeddedControlInput,
      };
    },
    toSession,
    canReuse: (record, args) => {
      const prepared = prepareChatTerminalSpawn(args);
      return (
        record.status === "running" &&
        record.cwd === args.workspacePath &&
        record.opencodeSessionId === args.opencodeSessionId &&
        record.opencodeServerUrl === args.opencodeServerUrl &&
        record.opencodeThemeMode === prepared.opencodeThemeMode &&
        record.preferredModel === prepared.preferredModelValue &&
        record.startMode === prepared.normalizedStartMode
      );
    },
    onSessionStarted: schedulePlanModeSwitch,
    runningErrorMessage: "Chat terminal session is not running",
  });

  return {
    ...controller,
    write(cellId, data) {
      const record = controller.sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Chat terminal session is not running");
      }

      if (!record.allowEmbeddedControlInput && isEmbeddedControlInput(data)) {
        return;
      }
      controller.write(cellId, data);
    },
  };
};

export const chatTerminalService = createChatTerminalService();
