import { describe, expect, it } from "vitest";
import {
  allowsEmbeddedChatControlInput,
  HIVE_BROWSER_SAFE_KEYBINDS,
  HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS,
  mergeHiveBrowserSafeKeybinds,
  mergeHiveEmbeddedBrowserSafeKeybinds,
  normalizeOpencodeKeybinds,
} from "./browser-safe-keybinds";

describe("normalizeOpencodeKeybinds", () => {
  it("keeps only string keybind values", () => {
    expect(
      normalizeOpencodeKeybinds({
        command_list: "<leader>p",
        "session.delete": false,
        invalidArray: ["ctrl+p"],
        invalidBoolean: false,
        invalidNumber: 1,
      })
    ).toEqual({
      "command.palette.show": "<leader>p",
      "session.delete": false,
    });
  });

  it("returns an empty map for non-object input", () => {
    expect(normalizeOpencodeKeybinds(null)).toEqual({});
    expect(normalizeOpencodeKeybinds("keybinds")).toEqual({});
    expect(normalizeOpencodeKeybinds(["ctrl+p"])).toEqual({});
  });
});

describe("mergeHiveBrowserSafeKeybinds", () => {
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
      expect(key in HIVE_BROWSER_SAFE_KEYBINDS).toBe(true);
    }
  });

  it("starts with Hive browser-safe defaults", () => {
    const merged = mergeHiveBrowserSafeKeybinds();

    expect(merged.leader).toBe("ctrl+x");
    expect(merged["app.exit"]).toBe("ctrl+c,ctrl+d,<leader>q");
    expect(merged["variant.cycle"]).toBe("<leader>t");
    expect(merged["theme.switch"]).toBe("<leader>j");
    expect(merged["command.palette.show"]).toBe("<leader>p");
    expect(merged["session.toggle.thinking"]).toBe("<leader>i");
    expect(merged["input.newline"]).toBe("shift+return,alt+return,ctrl+return");
    expect(merged["input.delete.word.backward"]).toBe(
      "ctrl+backspace,alt+backspace"
    );
  });

  it("lets later sources override defaults", () => {
    const merged = mergeHiveBrowserSafeKeybinds(
      { "command.palette.show": "<leader>j" },
      { "command.palette.show": "ctrl+space" }
    );

    expect(merged["command.palette.show"]).toBe("ctrl+space,<leader>p");
    expect(merged["variant.cycle"]).toBe(
      HIVE_BROWSER_SAFE_KEYBINDS["variant.cycle"]
    );
  });

  it("adds browser-safe aliases to custom bindings for risky actions", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      "variant.cycle": "ctrl+t",
      "theme.switch": "ctrl+y",
    });

    expect(merged["variant.cycle"]).toBe("ctrl+t,<leader>t");
    expect(merged["theme.switch"]).toBe("ctrl+y,<leader>j");
  });

  it("preserves explicit disabling with none", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      "variant.cycle": "none",
    });

    expect(merged["variant.cycle"]).toBe("none");
  });

  it("does not duplicate aliases when already present", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      "variant.cycle": "ctrl+t,<leader>t",
    });

    expect(merged["variant.cycle"]).toBe("ctrl+t,<leader>t");
  });

  it("preserves v2 binding objects and arrays when adding aliases", () => {
    const binding = { key: "ctrl+t", preventDefault: false };
    const merged = mergeHiveBrowserSafeKeybinds({
      "variant.cycle": [binding, "<leader>t"],
      "session.list": { name: "l", ctrl: true },
    });

    expect(merged["variant.cycle"]).toEqual([binding, "<leader>t"]);
    expect(merged["session.list"]).toEqual({ name: "l", ctrl: true });
  });

  it("uses leader-only app exit for embedded terminals", () => {
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS["app.exit"]).toBe("<leader>q");

    const merged = mergeHiveEmbeddedBrowserSafeKeybinds();
    expect(merged.leader).toBe("ctrl+x");
    expect(merged["app.exit"]).toBe("<leader>q");
  });

  it("keeps explicit leader overrides unchanged", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      leader: "ctrl+g",
    });

    expect(merged.leader).toBe("ctrl+g");
  });

  it("preserves explicit custom app exit in embedded terminals", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      "app.exit": "ctrl+c",
    });

    expect(merged["app.exit"]).toBe("ctrl+c,<leader>q");
  });

  it("maps legacy browser-safe IDs to their v2 command IDs", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      app_exit: "ctrl+c",
      variant_cycle: "ctrl+t",
    });

    expect(merged["app.exit"]).toBe("ctrl+c,<leader>q");
    expect(merged["variant.cycle"]).toBe("ctrl+t,<leader>t");
    expect(merged).not.toHaveProperty("app_exit");
    expect(merged).not.toHaveProperty("variant_cycle");
  });
});

describe("allowsEmbeddedChatControlInput", () => {
  it("disallows control app-exit combos by default in embedded terminals", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds();

    expect(allowsEmbeddedChatControlInput(merged)).toBe(false);
  });

  it("allows explicit ctrl+c overrides", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      "app.exit": "ctrl+c",
    });

    expect(allowsEmbeddedChatControlInput(merged)).toBe(true);
  });

  it("allows explicit ctrl+d overrides", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      "app.exit": "ctrl+d",
    });

    expect(allowsEmbeddedChatControlInput(merged)).toBe(true);
  });

  it("allows ctrl+c and ctrl+d bindings for non-exit actions", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      "command.palette.show": "ctrl+c",
      "session.toggle.thinking": "ctrl+d",
    });

    expect(allowsEmbeddedChatControlInput(merged)).toBe(true);
  });

  it("respects disabling app exit with none", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      "app.exit": "none",
    });

    expect(allowsEmbeddedChatControlInput(merged)).toBe(false);
  });
});
