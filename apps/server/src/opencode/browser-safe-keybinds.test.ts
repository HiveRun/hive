import { describe, expect, it } from "vitest";
import { HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS } from "./browser-safe-keybinds";

const CONTROL_EXIT_KEYBIND_PATTERN = /ctrl\+[cd]/;

describe("embedded browser-safe keybinds", () => {
  it("covers all known browser-conflicting defaults", () => {
    const knownBrowserConflicts = [
      "app.exit",
      "command.palette.show",
      "input.delete",
      "input.delete.line",
      "input.delete.to.line.end",
      "input.delete.to.line.start",
      "input.delete.word.backward",
      "input.line.end",
      "input.line.home",
      "input.move.left",
      "input.move.right",
      "input.newline",
      "input.undo",
      "input.word.backward",
      "input.word.forward",
      "model.dialog.favorite",
      "model.dialog.provider",
      "session.delete",
      "session.rename",
      "stash.delete",
      "variant.cycle",
    ];

    for (const key of knownBrowserConflicts) {
      expect(key in HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS).toBe(true);
    }
  });

  it.each([
    ["leader", "ctrl+x"],
    ["app.exit", "<leader>q"],
    ["variant.cycle", "<leader>t"],
    ["theme.switch", "<leader>j"],
    ["command.palette.show", "<leader>p"],
    ["session.toggle.thinking", "<leader>i"],
    ["input.newline", "shift+return,alt+return,ctrl+return"],
    ["input.delete.word.backward", "ctrl+backspace,alt+backspace"],
  ] satisfies ReadonlyArray<
    readonly [keyof typeof HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS, string]
  >)("uses the fixed Hive-owned %s binding", (key, expected) => {
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS[key]).toBe(expected);
  });

  it("does not emit app-exit control bytes", () => {
    expect(
      Object.values(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS).join(",")
    ).not.toMatch(CONTROL_EXIT_KEYBIND_PATTERN);
  });
});
