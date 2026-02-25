import { describe, expect, it } from "vitest";
import {
  allowsEmbeddedChatControlAppExit,
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
        invalidArray: ["ctrl+p"],
        invalidBoolean: false,
        invalidNumber: 1,
      })
    ).toEqual({ command_list: "<leader>p" });
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
      "app_exit",
      "command_list",
      "input_delete",
      "input_delete_line",
      "input_delete_to_line_end",
      "input_delete_to_line_start",
      "input_delete_word_backward",
      "input_line_end",
      "input_line_home",
      "input_move_left",
      "input_move_right",
      "input_newline",
      "input_undo",
      "input_word_backward",
      "input_word_forward",
      "model_favorite_toggle",
      "model_provider_list",
      "session_delete",
      "session_rename",
      "stash_delete",
      "variant_cycle",
    ];

    for (const key of knownBrowserConflicts) {
      expect(HIVE_BROWSER_SAFE_KEYBINDS).toHaveProperty(key);
    }
  });

  it("starts with Hive browser-safe defaults", () => {
    const merged = mergeHiveBrowserSafeKeybinds();

    expect(merged.app_exit).toBe("ctrl+c,ctrl+d,<leader>q");
    expect(merged.variant_cycle).toBe("<leader>t");
    expect(merged.theme_list).toBe("<leader>j");
    expect(merged.command_list).toBe("<leader>p");
    expect(merged.display_thinking).toBe("<leader>i");
    expect(merged.input_newline).toBe("shift+return,alt+return,ctrl+return");
    expect(merged.input_delete_word_backward).toBe(
      "ctrl+backspace,alt+backspace"
    );
  });

  it("lets later sources override defaults", () => {
    const merged = mergeHiveBrowserSafeKeybinds(
      { command_list: "<leader>j" },
      { command_list: "ctrl+space" }
    );

    expect(merged.command_list).toBe("ctrl+space,<leader>p");
    expect(merged.variant_cycle).toBe(HIVE_BROWSER_SAFE_KEYBINDS.variant_cycle);
  });

  it("adds browser-safe aliases to custom bindings for risky actions", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      variant_cycle: "ctrl+t",
      theme_list: "ctrl+y",
    });

    expect(merged.variant_cycle).toBe("ctrl+t,<leader>t");
    expect(merged.theme_list).toBe("ctrl+y,<leader>j");
  });

  it("preserves explicit disabling with none", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      variant_cycle: "none",
    });

    expect(merged.variant_cycle).toBe("none");
  });

  it("does not duplicate aliases when already present", () => {
    const merged = mergeHiveBrowserSafeKeybinds({
      variant_cycle: "ctrl+t,<leader>t",
    });

    expect(merged.variant_cycle).toBe("ctrl+t,<leader>t");
  });

  it("uses leader-only app exit for embedded terminals", () => {
    expect(HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS.app_exit).toBe("<leader>q");

    const merged = mergeHiveEmbeddedBrowserSafeKeybinds();
    expect(merged.app_exit).toBe("<leader>q");
  });

  it("preserves explicit custom app exit in embedded terminals", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      app_exit: "ctrl+c",
    });

    expect(merged.app_exit).toBe("ctrl+c,<leader>q");
  });
});

describe("allowsEmbeddedChatControlAppExit", () => {
  it("disallows control app-exit combos by default in embedded terminals", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds();

    expect(allowsEmbeddedChatControlAppExit(merged)).toBe(false);
  });

  it("allows explicit ctrl+c overrides", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      app_exit: "ctrl+c",
    });

    expect(allowsEmbeddedChatControlAppExit(merged)).toBe(true);
  });

  it("allows explicit ctrl+d overrides", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      app_exit: "ctrl+d",
    });

    expect(allowsEmbeddedChatControlAppExit(merged)).toBe(true);
  });

  it("respects disabling app exit with none", () => {
    const merged = mergeHiveEmbeddedBrowserSafeKeybinds({
      app_exit: "none",
    });

    expect(allowsEmbeddedChatControlAppExit(merged)).toBe(false);
  });
});
