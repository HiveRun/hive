type OpencodeKeyStroke = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
  hyper?: boolean;
};
type OpencodeKeybindItem =
  | string
  | OpencodeKeyStroke
  | ({ key: string | OpencodeKeyStroke } & Record<string, unknown>);
type OpencodeKeybindValue = false | OpencodeKeybindItem | OpencodeKeybindItem[];
type OpencodeKeybindsConfig = Record<string, OpencodeKeybindValue>;
type HiveBrowserSafeKeybindsConfig = Partial<OpencodeKeybindsConfig>;
const DEFAULT_LEADER_KEYBIND = "ctrl+x";
const CTRL_C_KEYBIND = "ctrl+c";
const CTRL_D_KEYBIND = "ctrl+d";
const EMBEDDED_CONTROL_KEYBINDS = new Set([CTRL_C_KEYBIND, CTRL_D_KEYBIND]);
const SOURCE_OVERRIDE_ONLY_KEYBINDS = new Set(["leader"]);
const LEGACY_KEYBIND_IDS: Record<string, string> = {
  app_exit: "app.exit",
  command_list: "command.palette.show",
  display_thinking: "session.toggle.thinking",
  input_delete: "input.delete",
  input_delete_line: "input.delete.line",
  input_delete_to_line_end: "input.delete.to.line.end",
  input_delete_to_line_start: "input.delete.to.line.start",
  input_delete_word_backward: "input.delete.word.backward",
  input_line_end: "input.line.end",
  input_line_home: "input.line.home",
  input_move_left: "input.move.left",
  input_move_right: "input.move.right",
  input_newline: "input.newline",
  input_select_line_end: "input.select.line.end",
  input_select_line_home: "input.select.line.home",
  input_undo: "input.undo",
  input_word_backward: "input.word.backward",
  input_word_forward: "input.word.forward",
  model_favorite_toggle: "model.dialog.favorite",
  model_provider_list: "model.dialog.provider",
  session_delete: "session.delete",
  session_rename: "session.rename",
  stash_delete: "stash.delete",
  theme_list: "theme.switch",
  variant_cycle: "variant.cycle",
};

const HIVE_BROWSER_SAFE_KEYBINDS_SOURCE = {
  leader: DEFAULT_LEADER_KEYBIND,
  "app.exit": "ctrl+c,ctrl+d,<leader>q",
  "command.palette.show": "<leader>p",
  "session.toggle.thinking": "<leader>i",
  "input.delete": "delete,shift+delete",
  "input.delete.line": "alt+shift+d",
  "input.delete.to.line.end": "alt+k",
  "input.delete.to.line.start": "alt+u",
  "input.delete.word.backward": "ctrl+backspace,alt+backspace",
  "input.line.end": "end",
  "input.line.home": "home",
  "input.move.left": "left",
  "input.move.right": "right",
  "input.newline": "shift+return,alt+return,ctrl+return",
  "input.select.line.end": "shift+end",
  "input.select.line.home": "shift+home",
  "input.undo": "super+z,alt+z",
  "input.word.backward": "ctrl+left,alt+b",
  "input.word.forward": "ctrl+right,alt+f",
  "model.dialog.favorite": "<leader>o",
  "model.dialog.provider": "<leader>z",
  "session.delete": "<leader>d",
  "session.rename": "<leader>k",
  "stash.delete": "<leader>d",
  "theme.switch": "<leader>j",
  "variant.cycle": "<leader>t",
} satisfies HiveBrowserSafeKeybindsConfig;

export const HIVE_BROWSER_SAFE_KEYBINDS: Record<string, string> =
  HIVE_BROWSER_SAFE_KEYBINDS_SOURCE;

const HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS_SOURCE = {
  ...HIVE_BROWSER_SAFE_KEYBINDS_SOURCE,
  "app.exit": "<leader>q",
} satisfies HiveBrowserSafeKeybindsConfig;

export const HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS: Record<string, string> =
  HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS_SOURCE;

const splitKeybindCombos = (value: string): string[] =>
  value
    .split(",")
    .map((combo) => combo.trim())
    .filter((combo) => combo.length > 0);

const keyStrokeCombos = (stroke: OpencodeKeyStroke): string[] => {
  const modifiers = [
    stroke.ctrl ? "ctrl" : undefined,
    stroke.shift ? "shift" : undefined,
    stroke.meta ? "meta" : undefined,
    stroke.super ? "super" : undefined,
    stroke.hyper ? "hyper" : undefined,
  ].filter((modifier): modifier is string => Boolean(modifier));
  return [`${modifiers.length ? `${modifiers.join("+")}+` : ""}${stroke.name}`];
};

const keybindCombos = (value: OpencodeKeybindValue): string[] => {
  if (value === false) {
    return [];
  }
  if (typeof value === "string") {
    return splitKeybindCombos(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap(keybindCombos);
  }
  if ("key" in value) {
    return typeof value.key === "string"
      ? splitKeybindCombos(value.key)
      : keyStrokeCombos(value.key);
  }
  return keyStrokeCombos(value);
};

const mergeKeybindCombos = (
  primary: OpencodeKeybindValue,
  aliases: string
): OpencodeKeybindValue => {
  const primaryCombos = keybindCombos(primary);
  if (
    primary === false ||
    primaryCombos.some((combo) => combo.toLowerCase() === "none")
  ) {
    return primary;
  }
  if (typeof primary === "string") {
    const merged = [...primaryCombos, ...splitKeybindCombos(aliases)];
    return [
      ...new Map(merged.map((combo) => [combo.toLowerCase(), combo])).values(),
    ].join(",");
  }

  const existing = new Set(primaryCombos.map((combo) => combo.toLowerCase()));
  const aliasItems = splitKeybindCombos(aliases).filter(
    (combo) => !existing.has(combo.toLowerCase())
  );
  return [...(Array.isArray(primary) ? primary : [primary]), ...aliasItems];
};

const normalizeKeyStroke = (value: unknown): OpencodeKeyStroke | undefined => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { name?: unknown }).name !== "string"
  ) {
    return;
  }
  const stroke = value as OpencodeKeyStroke;
  return stroke.name.trim() ? stroke : undefined;
};

const normalizeKeybindItem = (
  value: unknown
): OpencodeKeybindItem | undefined => {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  const stroke = normalizeKeyStroke(value);
  if (stroke) {
    return stroke;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("key" in value)
  ) {
    return;
  }
  const key =
    typeof value.key === "string"
      ? value.key.trim() || undefined
      : normalizeKeyStroke(value.key);
  return key ? ({ ...value, key } as OpencodeKeybindItem) : undefined;
};

const normalizeKeybindValue = (
  value: unknown
): OpencodeKeybindValue | undefined => {
  if (value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    const items = value
      .map(normalizeKeybindItem)
      .filter((item): item is OpencodeKeybindItem => item !== undefined);
    return items.length ? items : undefined;
  }
  return normalizeKeybindItem(value);
};

export function normalizeOpencodeKeybinds(
  candidate: unknown
): OpencodeKeybindsConfig {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const keybinds: OpencodeKeybindsConfig = {};
  for (const [key, value] of Object.entries(candidate)) {
    const normalizedKey = LEGACY_KEYBIND_IDS[key] ?? key;
    if (normalizedKey !== "leader" && !normalizedKey.includes(".")) {
      continue;
    }
    if (key !== normalizedKey && normalizedKey in candidate) {
      continue;
    }
    const normalizedValue = normalizeKeybindValue(value);
    if (normalizedValue === undefined) {
      continue;
    }
    keybinds[normalizedKey] = normalizedValue;
  }

  return keybinds;
}

export function mergeHiveBrowserSafeKeybinds(
  ...sources: unknown[]
): OpencodeKeybindsConfig {
  return mergeBrowserSafeKeybinds(HIVE_BROWSER_SAFE_KEYBINDS, ...sources);
}

export function mergeHiveEmbeddedBrowserSafeKeybinds(
  ...sources: unknown[]
): OpencodeKeybindsConfig {
  return mergeBrowserSafeKeybinds(
    HIVE_EMBEDDED_BROWSER_SAFE_KEYBINDS,
    ...sources
  );
}

function mergeBrowserSafeKeybinds(
  baseKeybinds: OpencodeKeybindsConfig,
  ...sources: unknown[]
): OpencodeKeybindsConfig {
  const merged: OpencodeKeybindsConfig = {
    ...baseKeybinds,
  };

  for (const source of sources) {
    const normalizedSource = normalizeOpencodeKeybinds(source);
    for (const [key, value] of Object.entries(normalizedSource)) {
      const browserSafeAliases = baseKeybinds[key];
      if (
        typeof browserSafeAliases === "string" &&
        !SOURCE_OVERRIDE_ONLY_KEYBINDS.has(key)
      ) {
        merged[key] = mergeKeybindCombos(value, browserSafeAliases);
        continue;
      }

      merged[key] = value;
    }
  }

  return merged;
}

export function allowsEmbeddedChatControlInput(keybinds: unknown): boolean {
  const normalizedKeybinds = normalizeOpencodeKeybinds(keybinds);

  return Object.values(normalizedKeybinds).some((keybind) =>
    keybindCombos(keybind).some((combo) =>
      EMBEDDED_CONTROL_KEYBINDS.has(combo.toLowerCase())
    )
  );
}
