import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type IExitEvent, type IPty, spawn } from "bun-pty";
import { Context, Layer } from "effect";

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const MAX_TERMINAL_BUFFER_CHARS = 2_000_000;
const BUFFER_RETAIN_CHARS = 1_600_000;
const TERMINAL_RESET_SEQUENCE = "\x1bc";
const TERMINAL_NAME = "xterm-256color";
const INSTALL_HINT = "curl -fsSL https://opencode.ai/install | bash";
const HIVE_THEME_NAME = "hive-resonant";
const HIVE_CONFIG_DIR_NAME = "hive-opencode-config";

const HIVE_THEME_CONTENT = `${JSON.stringify(
  {
    $schema: "https://opencode.ai/theme.json",
    defs: {
      obsidian: "#050708",
      graphite: "#111416",
      basalt: "#1F2629",
      amber: "#F5A524",
      honey: "#FFC857",
      signal: "#FF8F1F",
      pollen: "#FFE9A8",
      teal: "#2DD4BF",
      violet: "#7C5BFF",
      magma: "#FF5C5C",
      chlorophyll: "#8EDB5D",
      soot: "#0A0D0F",
      fog: "#B8BEC7",
      steel: "#6B7280",
      ivory: "#F7EBD1",
      daylight: "#F6F1E6",
      parchment: "#EFE5CF",
      ink: "#2B2520",
    },
    theme: {
      primary: { dark: "amber", light: "signal" },
      secondary: { dark: "honey", light: "amber" },
      accent: { dark: "signal", light: "signal" },
      error: { dark: "magma", light: "magma" },
      warning: { dark: "signal", light: "signal" },
      success: { dark: "teal", light: "chlorophyll" },
      info: { dark: "violet", light: "violet" },
      text: { dark: "ivory", light: "ink" },
      textMuted: { dark: "steel", light: "steel" },
      background: { dark: "obsidian", light: "daylight" },
      backgroundPanel: { dark: "graphite", light: "parchment" },
      backgroundElement: { dark: "basalt", light: "parchment" },
      border: { dark: "basalt", light: "#C7BDA6" },
      borderActive: { dark: "amber", light: "signal" },
      borderSubtle: { dark: "#1A1F22", light: "#D9D0BD" },
      diffAdded: { dark: "teal", light: "#2F7D4A" },
      diffRemoved: { dark: "magma", light: "#B93D3D" },
      diffContext: { dark: "fog", light: "#766C60" },
      diffHunkHeader: { dark: "honey", light: "amber" },
      diffHighlightAdded: { dark: "chlorophyll", light: "#2F7D4A" },
      diffHighlightRemoved: { dark: "magma", light: "#B93D3D" },
      diffAddedBg: { dark: "#12352D", light: "#DDEDD9" },
      diffRemovedBg: { dark: "#3D1717", light: "#F3D9D8" },
      diffContextBg: { dark: "soot", light: "daylight" },
      diffLineNumber: { dark: "steel", light: "steel" },
      diffAddedLineNumberBg: { dark: "#164439", light: "#D5E8D0" },
      diffRemovedLineNumberBg: { dark: "#4A1E1E", light: "#EED1D0" },
      markdownText: { dark: "ivory", light: "ink" },
      markdownHeading: { dark: "honey", light: "signal" },
      markdownLink: { dark: "teal", light: "#2A7D86" },
      markdownLinkText: { dark: "pollen", light: "#A35D11" },
      markdownCode: { dark: "honey", light: "#A35D11" },
      markdownBlockQuote: { dark: "steel", light: "steel" },
      markdownEmph: { dark: "signal", light: "signal" },
      markdownStrong: { dark: "amber", light: "signal" },
      markdownHorizontalRule: { dark: "basalt", light: "#D9D0BD" },
      markdownListItem: { dark: "amber", light: "signal" },
      markdownListEnumeration: { dark: "honey", light: "amber" },
      markdownImage: { dark: "teal", light: "#2A7D86" },
      markdownImageText: { dark: "pollen", light: "#A35D11" },
      markdownCodeBlock: { dark: "ivory", light: "ink" },
      syntaxComment: { dark: "steel", light: "steel" },
      syntaxKeyword: { dark: "signal", light: "signal" },
      syntaxFunction: { dark: "honey", light: "amber" },
      syntaxVariable: { dark: "pollen", light: "#4A3D2D" },
      syntaxString: { dark: "teal", light: "#2F7D4A" },
      syntaxNumber: { dark: "violet", light: "violet" },
      syntaxType: { dark: "amber", light: "signal" },
      syntaxOperator: { dark: "fog", light: "#6A6359" },
      syntaxPunctuation: { dark: "fog", light: "#7B7368" },
    },
  },
  null,
  2
)}\n`;

function resolveThemeConfigDir(): string {
  const configured =
    process.env.HIVE_OPENCODE_CONFIG_DIR?.trim() ??
    process.env.OPENCODE_CONFIG_DIR?.trim();

  if (configured && configured.length > 0) {
    return configured;
  }

  return join(tmpdir(), HIVE_CONFIG_DIR_NAME);
}

function parseInlineConfig(
  content: string | undefined
): Record<string, unknown> {
  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed OPENCODE_CONFIG_CONTENT and apply Hive defaults
  }

  return {};
}

function createOpencodeThemeEnv(): Record<string, string> {
  const configDir = resolveThemeConfigDir();
  const themeDir = join(configDir, "themes");
  const themePath = join(themeDir, `${HIVE_THEME_NAME}.json`);

  mkdirSync(themeDir, { recursive: true });

  const existingTheme = existsSync(themePath)
    ? readFileSync(themePath, "utf8")
    : null;
  if (existingTheme !== HIVE_THEME_CONTENT) {
    writeFileSync(themePath, HIVE_THEME_CONTENT, "utf8");
  }

  const inlineConfig = parseInlineConfig(process.env.OPENCODE_CONFIG_CONTENT);
  const mergedInlineConfig = {
    ...inlineConfig,
    theme: HIVE_THEME_NAME,
  };

  return {
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(mergedInlineConfig),
  };
}

export type ChatTerminalStatus = "running" | "exited";

export type ChatTerminalSession = {
  sessionId: string;
  cellId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: ChatTerminalStatus;
  exitCode: number | null;
  startedAt: string;
};

export type ChatTerminalEvent =
  | { type: "data"; chunk: string }
  | {
      type: "exit";
      exitCode: number;
      signal: number | string | null;
    };

type ChatTerminalRecord = {
  sessionId: string;
  cellId: string;
  cwd: string;
  pty: IPty;
  cols: number;
  rows: number;
  status: ChatTerminalStatus;
  exitCode: number | null;
  startedAt: Date;
  buffer: string;
  opencodeSessionId: string;
  opencodeServerUrl: string;
};

export type ChatTerminalService = {
  ensureSession(args: {
    cellId: string;
    workspacePath: string;
    opencodeSessionId: string;
    opencodeServerUrl: string;
  }): ChatTerminalSession;
  getSession(cellId: string): ChatTerminalSession | null;
  readOutput(cellId: string): string;
  subscribe(
    cellId: string,
    listener: (event: ChatTerminalEvent) => void
  ): () => void;
  write(cellId: string, data: string): void;
  resize(cellId: string, cols: number, rows: number): void;
  closeSession(cellId: string): void;
  stopAll(): void;
};

const toSession = (record: ChatTerminalRecord): ChatTerminalSession => ({
  sessionId: record.sessionId,
  cellId: record.cellId,
  pid: record.pty.pid,
  cwd: record.cwd,
  cols: record.cols,
  rows: record.rows,
  status: record.status,
  exitCode: record.exitCode,
  startedAt: record.startedAt.toISOString(),
});

const appendBuffer = (current: string, chunk: string): string => {
  if (!chunk.length) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return next;
  }

  const retainStart = Math.max(0, next.length - BUFFER_RETAIN_CHARS);
  const newlineBoundary = next.indexOf("\n", retainStart);
  const sliceStart = newlineBoundary >= 0 ? newlineBoundary + 1 : retainStart;
  const trimmed = next.slice(sliceStart);

  return `${TERMINAL_RESET_SEQUENCE}${trimmed}`;
};

const normalizeSignal = (
  signal: IExitEvent["signal"]
): number | string | null =>
  typeof signal === "number" || typeof signal === "string" ? signal : null;

const createChannel = (cellId: string): string => `chat:${cellId}`;

const resolveOpencodeBinary = (): string => {
  const configured = process.env.HIVE_OPENCODE_BIN?.trim();
  return configured && configured.length > 0 ? configured : "opencode";
};

const createSpawnErrorMessage = (binary: string, error: unknown): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return `Failed to start OpenCode chat terminal using '${binary}'. ${reason}. Install OpenCode with '${INSTALL_HINT}' or set HIVE_OPENCODE_BIN to the executable path.`;
};

const createChatTerminalService = (): ChatTerminalService => {
  const sessions = new Map<string, ChatTerminalRecord>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const closeSession = (cellId: string) => {
    const record = sessions.get(cellId);
    if (!record) {
      return;
    }

    try {
      record.pty.kill();
    } catch {
      // ignore kill failures on already-exited sessions
    }

    sessions.delete(cellId);
  };

  const ensureSession: ChatTerminalService["ensureSession"] = ({
    cellId,
    workspacePath,
    opencodeSessionId,
    opencodeServerUrl,
  }) => {
    const existing = sessions.get(cellId);
    if (
      existing &&
      existing.status === "running" &&
      existing.cwd === workspacePath &&
      existing.opencodeSessionId === opencodeSessionId &&
      existing.opencodeServerUrl === opencodeServerUrl
    ) {
      return toSession(existing);
    }

    if (existing) {
      closeSession(cellId);
    }

    const opencodeBinary = resolveOpencodeBinary();
    let opencodeThemeEnv: Record<string, string> = {};
    try {
      opencodeThemeEnv = createOpencodeThemeEnv();
    } catch {
      // proceed without custom Hive theme if runtime cannot write config artifacts
    }

    let pty: IPty;
    try {
      pty = spawn(
        opencodeBinary,
        [
          "attach",
          opencodeServerUrl,
          "--dir",
          workspacePath,
          "--session",
          opencodeSessionId,
        ],
        {
          name: TERMINAL_NAME,
          cols: DEFAULT_TERMINAL_COLS,
          rows: DEFAULT_TERMINAL_ROWS,
          cwd: workspacePath,
          env: {
            ...process.env,
            ...opencodeThemeEnv,
            TERM: TERMINAL_NAME,
            COLORTERM: process.env.COLORTERM ?? "truecolor",
          },
        }
      );
    } catch (error) {
      throw new Error(createSpawnErrorMessage(opencodeBinary, error));
    }

    const record: ChatTerminalRecord = {
      sessionId: `chat_terminal_${crypto.randomUUID()}`,
      cellId,
      pty,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: workspacePath,
      status: "running",
      exitCode: null,
      startedAt: new Date(),
      buffer: "",
      opencodeSessionId,
      opencodeServerUrl,
    };

    pty.onData((chunk: string) => {
      record.buffer = appendBuffer(record.buffer, chunk);
      emitter.emit(createChannel(cellId), {
        type: "data",
        chunk,
      } satisfies ChatTerminalEvent);
    });

    pty.onExit(({ exitCode, signal }: IExitEvent) => {
      record.status = "exited";
      record.exitCode = exitCode;
      emitter.emit(createChannel(cellId), {
        type: "exit",
        exitCode,
        signal: normalizeSignal(signal),
      } satisfies ChatTerminalEvent);
    });

    sessions.set(cellId, record);

    return toSession(record);
  };

  return {
    ensureSession,
    getSession(cellId) {
      const record = sessions.get(cellId);
      return record ? toSession(record) : null;
    },
    readOutput(cellId) {
      return sessions.get(cellId)?.buffer ?? "";
    },
    subscribe(cellId, listener) {
      const channel = createChannel(cellId);
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    write(cellId, data) {
      const record = sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Chat terminal session is not running");
      }
      record.pty.write(data);
    },
    resize(cellId, cols, rows) {
      const record = sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Chat terminal session is not running");
      }
      record.cols = cols;
      record.rows = rows;
      record.pty.resize(cols, rows);
    },
    closeSession,
    stopAll() {
      for (const cellId of [...sessions.keys()]) {
        closeSession(cellId);
      }
    },
  };
};

export const ChatTerminalServiceTag = Context.GenericTag<ChatTerminalService>(
  "@hive/server/ChatTerminalService"
);

export const ChatTerminalServiceLayer = Layer.succeed(
  ChatTerminalServiceTag,
  createChatTerminalService()
);
