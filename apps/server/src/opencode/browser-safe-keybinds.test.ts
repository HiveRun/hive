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

  it("uses fixed Hive-owned bindings without app-exit control bytes", () => {
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS.leader).toBe("ctrl+x");
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["app.exit"]).toBe("<leader>q");
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["variant.cycle"]).toBe(
      "<leader>t"
    );
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["theme.switch"]).toBe(
      "<leader>j"
    );
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["command.palette.show"]).toBe(
      "<leader>p"
    );
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["session.toggle.thinking"]).toBe(
      "<leader>i"
    );
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["input.newline"]).toBe(
      "shift+return,alt+return,ctrl+return"
    );
    expect(
      HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["input.delete.word.backward"]
    ).toBe("ctrl+backspace,alt+backspace");
    expect(
      Object.values(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS).join(",")
    ).not.toMatch(CONTROL_EXIT_KEYBIND_PATTERN);
  });
});
