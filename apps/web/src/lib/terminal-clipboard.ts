import type { Terminal as XTerm } from "@xterm/xterm";

type TerminalClipboardOptions = {
  terminal: XTerm;
  container: HTMLElement;
  canPaste?: boolean;
  onPasteText?: (text: string) => void;
  onCopySuccess?: () => void;
  onCopyError?: () => void;
  onPasteError?: () => void;
};

const isCtrlShiftClipboardModifier = (event: KeyboardEvent) =>
  event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;

const isExplicitCopyShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  return key === "c" && isCtrlShiftClipboardModifier(event);
};

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator?.clipboard?.writeText) {
    throw new Error("Clipboard write unavailable");
  }

  await navigator.clipboard.writeText(text);
}

export function registerTerminalClipboard(options: TerminalClipboardOptions) {
  const { canPaste = true, container, onPasteText, terminal } = options;

  const getSelection = () => {
    if (!terminal.hasSelection()) {
      return null;
    }
    const selection = terminal.getSelection();
    if (selection.length === 0) {
      return null;
    }

    return selection;
  };

  const copySelection = () => {
    const selection = getSelection();
    if (!selection) {
      return false;
    }

    copyTextToClipboard(selection)
      .then(() => {
        options.onCopySuccess?.();
      })
      .catch(() => {
        options.onCopyError?.();
      });

    return true;
  };

  const pasteText = (text: string) => {
    if (!canPaste || text.length === 0) {
      return;
    }

    onPasteText?.(text);
  };

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (isExplicitCopyShortcut(event)) {
      const handled = copySelection();
      if (!handled) {
        return true;
      }

      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    return true;
  });

  const handleCopy = (event: ClipboardEvent) => {
    const selection = getSelection();
    if (!selection) {
      return;
    }

    event.clipboardData?.setData("text/plain", selection);
    event.preventDefault();
    event.stopPropagation();
    options.onCopySuccess?.();
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (!canPaste) {
      return;
    }

    const text = event.clipboardData?.getData("text");
    if (!text) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    pasteText(text);
  };

  container.addEventListener("copy", handleCopy, true);
  container.addEventListener("paste", handlePaste, true);

  return () => {
    container.removeEventListener("copy", handleCopy, true);
    container.removeEventListener("paste", handlePaste, true);
    terminal.attachCustomKeyEventHandler(() => true);
  };
}
