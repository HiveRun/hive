import { describe, expect, it } from "vitest";
import { getModifiedEnterInput } from "./terminal-keyboard";

const createKeyboardEvent = (
  options: KeyboardEventInit & { type?: string } = {}
) =>
  new KeyboardEvent(options.type ?? "keydown", {
    key: "Enter",
    ...options,
  });

describe("terminal keyboard", () => {
  it("maps Shift+Enter to CSI-u modified Enter input", () => {
    expect(getModifiedEnterInput(createKeyboardEvent({ shiftKey: true }))).toBe(
      "\x1b[13;2u"
    );
  });

  it("maps Alt+Enter and Ctrl+Enter to CSI-u modified Enter input", () => {
    expect(getModifiedEnterInput(createKeyboardEvent({ altKey: true }))).toBe(
      "\x1b[13;3u"
    );
    expect(getModifiedEnterInput(createKeyboardEvent({ ctrlKey: true }))).toBe(
      "\x1b[13;5u"
    );
  });

  it("ignores plain Enter and unsupported modifier combinations", () => {
    expect(getModifiedEnterInput(createKeyboardEvent())).toBeNull();
    expect(
      getModifiedEnterInput(createKeyboardEvent({ metaKey: true }))
    ).toBeNull();
    expect(
      getModifiedEnterInput(
        createKeyboardEvent({ ctrlKey: true, shiftKey: true })
      )
    ).toBeNull();
  });

  it("ignores non-keydown events", () => {
    expect(
      getModifiedEnterInput(
        createKeyboardEvent({ shiftKey: true, type: "keyup" })
      )
    ).toBeNull();
  });
});
