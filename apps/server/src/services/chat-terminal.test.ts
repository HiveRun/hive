import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("bun-pty", () => ({ spawn: spawnMock }));

import { chatTerminalService } from "./chat-terminal";

const environmentNames = [
  "HIVE_CELLS_ROOT",
  "HIVE_HOME",
  "HIVE_OPENCODE_BIN",
  "HIVE_OPENCODE_SERVER_URL",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
  "XDG_STATE_HOME",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]])
);
const temporaryDirectories: string[] = [];
const EXECUTABLE_FILE_MODE = 0o755;
const MODE_ALIGNMENT_TIMEOUT_MS = 10_000;

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "hive-chat-terminal-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createPty() {
  return {
    pid: 42,
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

function createEnsureArgs(workspacePath: string) {
  return {
    cellId: crypto.randomUUID(),
    workspacePath,
    opencodeSessionId: "session-123",
    opencodeServerUrl: "http://127.0.0.1:4096",
    environment: { HIVE_CELL_ID: "cell-123" },
  };
}

function startTerminalSession() {
  const workspacePath = createTemporaryDirectory();
  const pty = createPty();
  const args = createEnsureArgs(workspacePath);
  spawnMock.mockReturnValueOnce(pty);
  chatTerminalService.ensureSession(args);
  return { args, pty };
}

function preparePtyReplacement() {
  const workspacePath = createTemporaryDirectory();
  const firstPty = createPty();
  const secondPty = createPty();
  const args = createEnsureArgs(workspacePath);
  spawnMock.mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
  return { args, firstPty, secondPty };
}

function withFakeTimers(run: () => void): void {
  vi.useFakeTimers();
  try {
    run();
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  const root = createTemporaryDirectory();
  const opencodeBinary = join(root, "opencode2");
  writeFileSync(
    opencodeBinary,
    "#!/bin/sh\nprintf '%s\\n' 'opencode2 v0.0.0-beta-19271'\n"
  );
  chmodSync(opencodeBinary, EXECUTABLE_FILE_MODE);
  process.env.HIVE_HOME = join(root, "hive-home");
  process.env.HIVE_OPENCODE_BIN = opencodeBinary;
  process.env.HIVE_OPENCODE_SERVER_URL = "";
  process.env.OPENCODE_CONFIG_CONTENT = "";
  process.env.OPENCODE_CONFIG_DIR = join(root, "global-config");
  process.env.OPENCODE_PASSWORD = "";
  process.env.OPENCODE_SERVER_PASSWORD = "";
  spawnMock.mockReset();
  spawnMock.mockImplementation(createPty);
});

afterEach(() => {
  chatTerminalService.stopAll();
  for (const name of environmentNames) {
    process.env[name] = originalEnvironment[name];
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OpenCode 2 chat terminal", () => {
  it("uses managed service attachment and writes an isolated v2 cli.json", () => {
    const workspacePath = createTemporaryDirectory();
    const globalConfigDirectory = process.env.OPENCODE_CONFIG_DIR as string;
    mkdirSync(globalConfigDirectory, { recursive: true });
    writeFileSync(
      join(globalConfigDirectory, "cli.json"),
      JSON.stringify({
        animations: false,
        keybinds: { "session.list": "ctrl+l" },
      })
    );
    mkdirSync(join(workspacePath, ".opencode"), { recursive: true });
    writeFileSync(
      join(workspacePath, ".opencode", "opencode.jsonc"),
      '{ "keybinds": { "variant_cycle": "ctrl+v" } } // project config\n'
    );
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      keybinds: { command_list: "ctrl+p" },
      theme: "external-theme",
      default_agent: "build",
    });
    process.env.HIVE_CELLS_ROOT = "/parent/cells";
    chatTerminalService.ensureSession(createEnsureArgs(workspacePath));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [binary, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe(process.env.HIVE_OPENCODE_BIN);
    expect(args).toEqual([
      "--server",
      "http://127.0.0.1:4096",
      "--session",
      "session-123",
      workspacePath,
    ]);
    expect(args).not.toContain("attach");
    expect(args).not.toContain("--hostname");
    expect(args).not.toContain("--port");
    expect(options.cwd).toBe(workspacePath);
    expect(options.env.XDG_CONFIG_HOME).toBe(
      join(workspacePath, ".opencode", "state", "xdg", "config")
    );
    expect(options.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");

    const cliConfig = JSON.parse(
      readFileSync(
        join(options.env.XDG_CONFIG_HOME, "opencode", "cli.json"),
        "utf8"
      )
    );
    expect(cliConfig).toMatchObject({
      $schema: "https://opencode.ai/v2/cli.json",
      theme: { name: "hive-resonant", mode: "dark" },
      keybinds: {
        "app.exit": "<leader>q",
        "command.palette.show": "<leader>p",
        "variant.cycle": "<leader>t",
      },
    });
    expect(options.env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    expect(options.env).not.toHaveProperty("OPENCODE_CONFIG_DIR");
    expect(options.env).not.toHaveProperty("HIVE_CELLS_ROOT");
  });

  it("uses authenticated --server for an explicit server URL", () => {
    const workspacePath = createTemporaryDirectory();
    process.env.HIVE_OPENCODE_SERVER_URL = "http://127.0.0.1:4096";
    process.env.OPENCODE_PASSWORD = "secret";

    chatTerminalService.ensureSession(createEnsureArgs(workspacePath));

    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      "--server",
      "http://127.0.0.1:4096",
      "--session",
      "session-123",
      workspacePath,
    ]);
    expect(spawnMock.mock.calls[0]?.[2].env.OPENCODE_PASSWORD).toBe("secret");
  });

  it("passes managed shared-service authentication to the TUI", () => {
    const workspacePath = createTemporaryDirectory();

    chatTerminalService.ensureSession({
      ...createEnsureArgs(workspacePath),
      opencodeServerPassword: "secret",
    });

    expect(spawnMock.mock.calls[0]?.[2].env.OPENCODE_PASSWORD).toBe("secret");
  });

  it("ignores callbacks from a replaced PTY", () => {
    const { args, firstPty } = preparePtyReplacement();

    chatTerminalService.ensureSession(args);
    chatTerminalService.ensureSession({
      ...args,
      opencodeThemeMode: "light",
    });
    firstPty.onData.mock.calls[0]?.[0]("stale output");
    firstPty.onExit.mock.calls[0]?.[0]({ exitCode: 1, signal: null });

    expect(firstPty.kill).toHaveBeenCalledOnce();
    expect(chatTerminalService.getSession(args.cellId)?.status).toBe("running");
    expect(chatTerminalService.readOutput(args.cellId)).not.toContain(
      "stale output"
    );
  });

  it("reuses the attached PTY when reconnecting to the same session", () => {
    const workspacePath = createTemporaryDirectory();
    const args = createEnsureArgs(workspacePath);

    chatTerminalService.ensureSession(args);
    chatTerminalService.ensureSession(args);

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("recreates an exited PTY when reconnecting to the same session", () => {
    const workspacePath = createTemporaryDirectory();
    const firstPty = createPty();
    const secondPty = createPty();
    const args = createEnsureArgs(workspacePath);
    spawnMock.mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    chatTerminalService.ensureSession(args);
    firstPty.onExit.mock.calls[0]?.[0]({ exitCode: 1, signal: null });

    chatTerminalService.ensureSession(args);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(chatTerminalService.getSession(args.cellId)?.status).toBe("running");
  });

  it("detects split and coalesced Build/Plan render chunks", () => {
    const workspacePath = createTemporaryDirectory();
    const pty = createPty();
    const args = {
      ...createEnsureArgs(workspacePath),
      startMode: "plan" as const,
    };
    spawnMock.mockReturnValueOnce(pty);
    chatTerminalService.ensureSession(args);
    chatTerminalService.write(args.cellId, "queued prompt");

    const onData = pty.onData.mock.calls[0]?.[0];
    onData("\x1b[?20");
    onData("26h\x1b[33;6HBu");
    expect(pty.write).not.toHaveBeenCalled();
    onData("ild\x1b[33;12H · model\x1b[?2026l");

    expect(pty.write).toHaveBeenCalledOnce();
    expect(pty.write).toHaveBeenCalledWith("\x1b[Z");

    onData(
      "\x1b[?2026h\x1b[33;6HBuild\x1b[33;12H · model\x1b[?2026l" +
        "\x1b[?2026h\x1b[33;6HPlan\x1b[33;12H · model\x1b[?2026l"
    );
    expect(pty.write).toHaveBeenNthCalledWith(2, "queued prompt");
    expect(pty.write).toHaveBeenCalledTimes(2);
  });

  it("preserves queued input across a compatible PTY replacement", () => {
    withFakeTimers(() => {
      const { args, firstPty, secondPty } = preparePtyReplacement();
      chatTerminalService.ensureSession({ ...args, startMode: "plan" });
      chatTerminalService.write(args.cellId, "queued prompt");

      chatTerminalService.ensureSession({
        ...args,
        opencodeThemeMode: "light",
        startMode: "plan",
      });
      vi.advanceTimersByTime(MODE_ALIGNMENT_TIMEOUT_MS);

      expect(firstPty.write).not.toHaveBeenCalled();
      expect(secondPty.write).toHaveBeenCalledOnce();
      expect(secondPty.write).toHaveBeenCalledWith("queued prompt");
    });
  });

  it("writes queued input once after a reentrant compatible replacement", () => {
    withFakeTimers(() => {
      const workspacePath = createTemporaryDirectory();
      const ptys = [createPty(), createPty(), createPty()] as const;
      const args = {
        ...createEnsureArgs(workspacePath),
        startMode: "plan" as const,
      };
      spawnMock
        .mockReturnValueOnce(ptys[0])
        .mockReturnValueOnce(ptys[1])
        .mockReturnValueOnce(ptys[2]);
      chatTerminalService.ensureSession(args);
      chatTerminalService.write(args.cellId, "queued prompt");
      let unsubscribe: (() => void) | undefined;
      unsubscribe = chatTerminalService.subscribe(args.cellId, (event) => {
        if (event.type !== "session") {
          return;
        }
        unsubscribe?.();
        chatTerminalService.ensureSession(args);
      });

      chatTerminalService.ensureSession({
        ...args,
        opencodeThemeMode: "light",
      });
      vi.advanceTimersByTime(MODE_ALIGNMENT_TIMEOUT_MS);

      expect(ptys[0].write).not.toHaveBeenCalled();
      expect(ptys[1].write).not.toHaveBeenCalled();
      expect(ptys[2].write).toHaveBeenCalledOnce();
      expect(ptys[2].write).toHaveBeenCalledWith("queued prompt");
    });
  });

  it("releases a queued prompt when the mode footer does not render", () => {
    withFakeTimers(() => {
      const workspacePath = createTemporaryDirectory();
      const pty = createPty();
      const args = {
        ...createEnsureArgs(workspacePath),
        startMode: "plan" as const,
      };
      spawnMock.mockReturnValueOnce(pty);
      chatTerminalService.ensureSession(args);
      chatTerminalService.write(args.cellId, "queued prompt");

      vi.advanceTimersByTime(MODE_ALIGNMENT_TIMEOUT_MS);

      expect(pty.write).toHaveBeenCalledWith("queued prompt");
    });
  });

  it("writes ordinary terminal input immediately", () => {
    const { args, pty } = startTerminalSession();

    chatTerminalService.write(args.cellId, "hello\n");

    expect(pty.write).toHaveBeenCalledOnce();
    expect(pty.write).toHaveBeenCalledWith("hello\n");
  });

  it("suppresses embedded app-exit control input", () => {
    const { args, pty } = startTerminalSession();

    chatTerminalService.write(args.cellId, "\u0003");
    chatTerminalService.write(args.cellId, "\u0004");

    expect(pty.write).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated explicit server URL", () => {
    const workspacePath = createTemporaryDirectory();
    process.env.HIVE_OPENCODE_SERVER_URL = "http://127.0.0.1:4096";

    expect(() =>
      chatTerminalService.ensureSession(createEnsureArgs(workspacePath))
    ).toThrow(
      "HIVE_OPENCODE_SERVER_URL requires OPENCODE_PASSWORD (or OPENCODE_SERVER_PASSWORD)"
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("reports v2-only recovery guidance when spawning fails", () => {
    const workspacePath = createTemporaryDirectory();
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    expect(() =>
      chatTerminalService.ensureSession(createEnsureArgs(workspacePath))
    ).toThrow(
      "Reinstall Hive or set HIVE_OPENCODE_BIN to the opencode2 executable"
    );
  });
});
