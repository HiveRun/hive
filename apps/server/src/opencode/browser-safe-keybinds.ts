import type { ServerOptions } from "@opencode-ai/sdk/v2";

type OpencodeKeybindsConfig = NonNullable<
  NonNullable<ServerOptions["config"]>["keybinds"]
>;
type HiveBrowserSafeKeybindsConfig = Partial<OpencodeKeybindsConfig>;

const HIVE_BROWSER_SAFE_KEYBINDS_SOURCE = {
  app_exit: "ctrl+c,ctrl+d,<leader>q",
  command_list: "<leader>p",
  display_thinking: "<leader>i",
  input_delete: "delete,shift+delete",
  input_delete_line: "alt+shift+d",
  input_delete_to_line_end: "alt+k",
  input_delete_to_line_start: "alt+u",
  input_delete_word_backward: "ctrl+backspace,alt+backspace",
  input_line_end: "end",
  input_line_home: "home",
  input_move_left: "left",
  input_move_right: "right",
  input_newline: "shift+return,alt+return,ctrl+return",
  input_select_line_end: "shift+end",
  input_select_line_home: "shift+home",
  input_undo: "super+z,alt+z",
  input_word_backward: "ctrl+left,alt+b",
  input_word_forward: "ctrl+right,alt+f",
  model_favorite_toggle: "<leader>o",
  model_provider_list: "<leader>z",
  session_delete: "<leader>d",
  session_rename: "<leader>k",
  stash_delete: "<leader>d",
  theme_list: "<leader>j",
  variant_cycle: "<leader>t",
} satisfies HiveBrowserSafeKeybindsConfig;

export const HIVE_BROWSER_SAFE_KEYBINDS: Record<string, string> =
  HIVE_BROWSER_SAFE_KEYBINDS_SOURCE;

const HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS_SOURCE = {
  ...HIVE_BROWSER_SAFE_KEYBINDS_SOURCE,
  app_exit: "<leader>q",
} satisfies HiveBrowserSafeKeybindsConfig;

export const HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS: Record<string, string> =
  HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS_SOURCE;

const splitKeybindCombos = (value: string): string[] =>
  value
    .split(",")
    .map((combo) => combo.trim())
    .filter((combo) => combo.length > 0);

const mergeKeybindCombos = (primary: string, aliases: string): string => {
  const primaryCombos = splitKeybindCombos(primary);
  if (primaryCombos.some((combo) => combo.toLowerCase() === "none")) {
    return "none";
  }

  const mergedCombos: string[] = [];
  const seen = new Set<string>();

  for (const combo of [...primaryCombos, ...splitKeybindCombos(aliases)]) {
    const normalized = combo.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    mergedCombos.push(combo);
  }

  return mergedCombos.join(",");
};

export function normalizeOpencodeKeybinds(
  candidate: unknown
): Record<string, string> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const keybinds: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalizedValue = value.trim();
    if (normalizedValue.length === 0) {
      continue;
    }
    keybinds[key] = normalizedValue;
  }

  return keybinds;
}

export function mergeHiveBrowserSafeKeybinds(
  ...sources: unknown[]
): Record<string, string> {
  return mergeBrowserSafeKeybinds(HIVE_BROWSER_SAFE_KEYBINDS, ...sources);
}

export function mergeHiveEmbeddedBrowserSafeKeybinds(
  ...sources: unknown[]
): Record<string, string> {
  return mergeBrowserSafeKeybinds(
    HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS,
    ...sources
  );
}

function mergeBrowserSafeKeybinds(
  baseKeybinds: Record<string, string>,
  ...sources: unknown[]
): Record<string, string> {
  const merged: Record<string, string> = {
    ...baseKeybinds,
  };

  for (const source of sources) {
    const normalizedSource = normalizeOpencodeKeybinds(source);
    for (const [key, value] of Object.entries(normalizedSource)) {
      const browserSafeAliases = baseKeybinds[key];
      merged[key] = browserSafeAliases
        ? mergeKeybindCombos(value, browserSafeAliases)
        : value;
    }
  }

  return merged;
}
