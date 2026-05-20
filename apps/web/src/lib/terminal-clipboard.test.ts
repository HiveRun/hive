import type { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  formatBracketedPaste,
  registerTerminalClipboard,
} from "./terminal-clipboard";

const createPasteEvent = (text: string) => {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;

  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: vi.fn(() => text),
    },
  });

  return event;
};

const createTerminal = () =>
  ({
    attachCustomKeyEventHandler: vi.fn(),
    getSelection: vi.fn(() => ""),
    hasSelection: vi.fn(() => false),
    paste: vi.fn(),
  }) as unknown as XTerm;

const registerTestClipboard = (
  options: Omit<
    Parameters<typeof registerTerminalClipboard>[0],
    "container"
  > & {
    container?: HTMLElement;
  }
) => {
  const container = options.container ?? document.createElement("div");
  const cleanup = registerTerminalClipboard({ ...options, container });

  return { cleanup, container };
};

describe("terminal clipboard", () => {
  it("formats pasted text as bracketed paste", () => {
    expect(formatBracketedPaste("hello")).toBe("\x1b[200~hello\x1b[201~");
  });

  it("normalizes pasted line endings inside bracketed paste", () => {
    expect(formatBracketedPaste("line1\r\nline2\rline3")).toBe(
      "\x1b[200~line1\nline2\nline3\x1b[201~"
    );
  });

  it("sends clipboard paste through bracketed paste markers", () => {
    const terminal = createTerminal();
    const { cleanup, container } = registerTestClipboard({ terminal });
    const event = createPasteEvent("line1\nline2");

    container.dispatchEvent(event);

    expect(terminal.paste).toHaveBeenCalledWith(
      "\x1b[200~line1\nline2\x1b[201~"
    );
    expect(event.defaultPrevented).toBe(true);

    cleanup();
  });

  it("lets custom keydown handlers intercept terminal input", () => {
    const terminal = createTerminal();
    const onKeyDown = vi.fn(() => false);
    const { cleanup } = registerTestClipboard({
      onKeyDown,
      terminal,
    });
    const handler = vi.mocked(terminal.attachCustomKeyEventHandler).mock
      .calls[0]?.[0];
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Enter",
      shiftKey: true,
    });

    expect(handler?.(event)).toBe(false);
    expect(onKeyDown).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);

    cleanup();
  });

  it("ignores empty clipboard text", () => {
    const terminal = createTerminal();
    const { cleanup, container } = registerTestClipboard({ terminal });

    container.dispatchEvent(createPasteEvent(""));

    expect(terminal.paste).not.toHaveBeenCalled();

    cleanup();
  });
});
