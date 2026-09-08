import "../config/runtime-env";

import { type IPty, spawn } from "bun-pty";
import { resolveOpencodeBinary } from "../agents/opencode-binary";
import type { AgentMode } from "../agents/types";
import { prepareEmbeddedOpencodeCliConfig } from "../opencode/embedded-cli-config";
import {
  areCellEnvironmentsEqual,
  ensureCellEnvironment,
} from "./cell-environment";
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
const HIVE_THEME_NAME = "hive-resonant";
const DEFAULT_THEME_MODE = "dark";
const ASCII_END_OF_TEXT = "\u0003";
const ASCII_END_OF_TRANSMISSION = "\u0004";
const ASCII_ESCAPE_CODE = 27;
const AGENT_CYCLE_INPUT = "\x1b[Z";
const MODE_ALIGNMENT_BUFFER_CHARS = 128_000;
const MODE_ALIGNMENT_PENDING_INPUT_CHARS = 128_000;
const MODE_ALIGNMENT_INPUT_TIMEOUT_MS = 10_000;
const MODE_FOOTER_ROW_OFFSET = 3;
const TUI_RENDER_START = `${String.fromCharCode(ASCII_ESCAPE_CODE)}[?2026h`;
const TUI_RENDER_END = `${String.fromCharCode(ASCII_ESCAPE_CODE)}[?2026l`;
const ANSI_CSI_PATTERN = new RegExp(
  String.raw`${String.fromCharCode(ASCII_ESCAPE_CODE)}\[[0-?]*[ -/]*[@-~]`,
  "g"
);
const CURSOR_POSITION_PATTERN = new RegExp(
  String.raw`${String.fromCharCode(ASCII_ESCAPE_CODE)}\[(\d+);(\d+)H`,
  "g"
);
const MODE_FOOTER_PATTERN = /\b(Plan|Build)\b\s*[·•]/;
const LINE_END_PATTERN = /[\r\n]/;

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

const isEmbeddedControlInput = (data: string): boolean =>
  data === ASCII_END_OF_TEXT || data === ASCII_END_OF_TRANSMISSION;

const normalizeStartMode = (
  value: string | undefined
): AgentMode | undefined =>
  value === "plan" || value === "build" ? value : undefined;

function createOpencodeTerminalEnv(
  workspacePath: string,
  themeMode: "dark" | "light"
): {
  env: Record<string, string>;
  allowEmbeddedControlInput: boolean;
} {
  const cliConfig = prepareEmbeddedOpencodeCliConfig({
    workspacePath,
    themeName: HIVE_THEME_NAME,
    themeMode,
    themeContent: HIVE_THEME_CONTENT,
  });

  return {
    env: {
      XDG_CONFIG_HOME: cliConfig.configHome,
    },
    allowEmbeddedControlInput: cliConfig.allowEmbeddedControlInput,
  };
}

export type ChatTerminalSession = TerminalSessionFields & {
  cellId: string;
};

export type ChatTerminalEvent = TerminalEvent<ChatTerminalSession>;

type ChatTerminalRecord = TerminalRecordFields & {
  cellId: string;
  pty: IPty;
  opencodeSessionId: string;
  opencodeServerUrl: string;
  opencodeServerPassword?: string;
  opencodeThemeMode: "dark" | "light";
  startMode?: AgentMode;
  modeAlignmentBuffer: string;
  modeAlignmentCycleSent: boolean;
  modeAlignmentComplete: boolean;
  modeAlignmentInputTimeout?: ReturnType<typeof setTimeout>;
  pendingInput: string;
  allowEmbeddedControlInput: boolean;
  environment: Record<string, string>;
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
    opencodeServerPassword?: string;
    opencodeThemeMode?: "dark" | "light";
    startMode?: AgentMode;
    environment: Record<string, string>;
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

const createChannel = (cellId: string): string => `chat:${cellId}`;

const createSpawnErrorMessage = (binary: string, error: unknown): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return `Failed to start OpenCode 2 chat terminal using '${binary}'. ${reason}. Reinstall Hive or set HIVE_OPENCODE_BIN to the opencode2 executable.`;
};

function resolveModeFromRender(
  render: string,
  terminalRows: number
): AgentMode | undefined {
  const footerRow = Math.max(1, terminalRows - MODE_FOOTER_ROW_OFFSET);
  const cursorPositions = [...render.matchAll(CURSOR_POSITION_PATTERN)];
  const renderedRows = new Map<number, string[]>();
  for (const [index, match] of cursorPositions.entries()) {
    const row = Number(match[1]);
    if (row !== footerRow) {
      continue;
    }
    const column = Number(match[2]);
    const segmentEnd = cursorPositions[index + 1]?.index ?? render.length;
    const segment = render
      .slice((match.index ?? 0) + match[0].length, segmentEnd)
      .replace(ANSI_CSI_PATTERN, "");
    const cells = renderedRows.get(row) ?? [];
    while (cells.length < column - 1) {
      cells.push(" ");
    }
    const characters = [...(segment.split(LINE_END_PATTERN, 1)[0] ?? "")];
    cells.splice(column - 1, characters.length, ...characters);
    renderedRows.set(row, cells);
  }

  const label = [...renderedRows.values()]
    .map((cells) => cells.join("").match(MODE_FOOTER_PATTERN)?.[1])
    .find((candidate) => candidate !== undefined);
  if (label === "Plan") {
    return "plan";
  }
  if (label === "Build") {
    return "build";
  }
  return;
}

function resolveRenderedMode(
  output: string,
  terminalRows: number
): AgentMode | undefined {
  const modes: AgentMode[] = [];
  let searchFrom = 0;
  while (searchFrom < output.length) {
    const renderStart = output.indexOf(TUI_RENDER_START, searchFrom);
    if (renderStart < 0) {
      break;
    }
    const renderEnd = output.indexOf(
      TUI_RENDER_END,
      renderStart + TUI_RENDER_START.length
    );
    if (renderEnd < 0) {
      return;
    }
    const mode = resolveModeFromRender(
      output.slice(renderStart, renderEnd),
      terminalRows
    );
    if (mode) {
      modes.push(mode);
    }
    searchFrom = renderEnd + TUI_RENDER_END.length;
  }
  return modes.at(-1);
}

function completeModeAlignment(record: ChatTerminalRecord): void {
  if (record.modeAlignmentComplete) {
    return;
  }
  if (record.modeAlignmentInputTimeout) {
    clearTimeout(record.modeAlignmentInputTimeout);
    record.modeAlignmentInputTimeout = undefined;
  }
  record.modeAlignmentComplete = true;
  if (record.pendingInput) {
    record.pty.write(record.pendingInput);
    record.pendingInput = "";
  }
}

function disposeModeAlignment(record: ChatTerminalRecord): void {
  if (record.modeAlignmentInputTimeout) {
    clearTimeout(record.modeAlignmentInputTimeout);
    record.modeAlignmentInputTimeout = undefined;
  }
  record.pendingInput = "";
}

function alignRenderedMode(record: ChatTerminalRecord, chunk: string): void {
  if (!record.startMode || record.modeAlignmentComplete) {
    return;
  }
  record.modeAlignmentBuffer = `${record.modeAlignmentBuffer}${chunk}`.slice(
    -MODE_ALIGNMENT_BUFFER_CHARS
  );
  const renderedMode = resolveRenderedMode(
    record.modeAlignmentBuffer,
    record.rows
  );
  if (!renderedMode) {
    return;
  }
  if (renderedMode !== record.startMode) {
    if (!record.modeAlignmentCycleSent) {
      record.modeAlignmentCycleSent = true;
      record.pty.write(AGENT_CYCLE_INPUT);
    }
    return;
  }
  completeModeAlignment(record);
}

function resolveServerArgs(serverUrl: string): string[] {
  const explicitServerUrl = process.env.HIVE_OPENCODE_SERVER_URL?.trim();
  if (
    explicitServerUrl &&
    !(process.env.OPENCODE_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD)
  ) {
    throw new Error(
      "HIVE_OPENCODE_SERVER_URL requires OPENCODE_PASSWORD (or OPENCODE_SERVER_PASSWORD) for an authenticated OpenCode 2 --server connection."
    );
  }

  return ["--server", explicitServerUrl || serverUrl];
}

type ChatTerminalEnsureArgs = Parameters<
  ChatTerminalService["ensureSession"]
>[0];

const prepareChatTerminalSpawn = ({
  workspacePath,
  opencodeSessionId,
  opencodeThemeMode = DEFAULT_THEME_MODE,
  startMode,
  opencodeServerUrl,
  opencodeServerPassword,
}: ChatTerminalEnsureArgs) => {
  const normalizedStartMode = normalizeStartMode(startMode);
  const terminalConfig = createOpencodeTerminalEnv(
    workspacePath,
    opencodeThemeMode
  );

  return {
    normalizedStartMode,
    opencodeThemeMode,
    allowEmbeddedControlInput: terminalConfig.allowEmbeddedControlInput,
    spawnOptions: {
      args: [
        ...resolveServerArgs(opencodeServerUrl),
        "--session",
        opencodeSessionId,
        workspacePath,
      ],
      env: {
        ...terminalConfig.env,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        ...(opencodeServerPassword
          ? { OPENCODE_PASSWORD: opencodeServerPassword }
          : {}),
      },
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
      const {
        OPENCODE_CONFIG_CONTENT: _inlineConfig,
        OPENCODE_CONFIG_DIR: _externalConfigDirectory,
        ...hostEnvironment
      } = process.env;
      ensureCellEnvironment(args.cellId, args.workspacePath);
      try {
        return spawn(opencodeBinary, prepared.spawnOptions.args, {
          name: TERMINAL_NAME,
          cols: DEFAULT_TERMINAL_COLS,
          rows: DEFAULT_TERMINAL_ROWS,
          cwd: args.workspacePath,
          env: {
            ...hostEnvironment,
            ...args.environment,
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
        opencodeServerPassword: args.opencodeServerPassword,
        opencodeThemeMode: prepared.opencodeThemeMode,
        startMode: prepared.normalizedStartMode,
        modeAlignmentBuffer: "",
        modeAlignmentCycleSent: false,
        modeAlignmentComplete: false,
        pendingInput: "",
        allowEmbeddedControlInput: prepared.allowEmbeddedControlInput,
        environment: args.environment,
      };
    },
    onData: alignRenderedMode,
    onClose: disposeModeAlignment,
    toSession,
    canReuse: (record, args) => {
      const prepared = prepareChatTerminalSpawn(args);
      return (
        record.status === "running" &&
        record.cwd === args.workspacePath &&
        record.opencodeSessionId === args.opencodeSessionId &&
        record.opencodeServerUrl === args.opencodeServerUrl &&
        record.opencodeServerPassword === args.opencodeServerPassword &&
        record.opencodeThemeMode === prepared.opencodeThemeMode &&
        areCellEnvironmentsEqual(record.environment, args.environment)
      );
    },
    runningErrorMessage: "Chat terminal session is not running",
  });

  function canTransferPendingInput(
    record: ChatTerminalRecord,
    args: ChatTerminalEnsureArgs
  ): boolean {
    return (
      record.status === "running" &&
      record.cwd === args.workspacePath &&
      record.opencodeSessionId === args.opencodeSessionId &&
      record.opencodeServerUrl === args.opencodeServerUrl &&
      record.opencodeServerPassword === args.opencodeServerPassword
    );
  }

  function write(cellId: string, data: string): void {
    const record = controller.sessions.get(cellId);
    if (!record || record.status !== "running") {
      throw new Error("Chat terminal session is not running");
    }

    if (!record.allowEmbeddedControlInput && isEmbeddedControlInput(data)) {
      return;
    }
    if (record.startMode && !record.modeAlignmentComplete) {
      if (
        record.pendingInput.length + data.length >
        MODE_ALIGNMENT_PENDING_INPUT_CHARS
      ) {
        completeModeAlignment(record);
        controller.write(cellId, data);
        return;
      }
      record.pendingInput += data;
      if (!record.modeAlignmentInputTimeout) {
        record.modeAlignmentInputTimeout = setTimeout(() => {
          if (
            controller.sessions.get(cellId) === record &&
            record.status === "running"
          ) {
            completeModeAlignment(record);
          }
        }, MODE_ALIGNMENT_INPUT_TIMEOUT_MS);
        record.modeAlignmentInputTimeout.unref();
      }
      return;
    }
    controller.write(cellId, data);
  }

  return {
    ...controller,
    ensureSession(args) {
      const existing = controller.sessions.get(args.cellId);
      const pendingInput =
        existing && canTransferPendingInput(existing, args)
          ? existing.pendingInput
          : "";
      const session = controller.ensureSession(args);
      const current = controller.sessions.get(args.cellId);
      if (
        pendingInput &&
        current !== existing &&
        current &&
        canTransferPendingInput(current, args)
      ) {
        write(args.cellId, pendingInput);
      }
      return session;
    },
    write,
  };
};

export const chatTerminalService = createChatTerminalService();
