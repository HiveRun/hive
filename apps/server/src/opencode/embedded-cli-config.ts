import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  allowsEmbeddedChatControlInput,
  mergeHiveEmbeddedBrowserSafeKeybinds,
} from "./browser-safe-keybinds";

const CLI_SCHEMA_URL = "https://opencode.ai/v2/cli.json";
const EMBEDDED_CONFIG_HOME = [".opencode", "state", "xdg", "config"] as const;

type EmbeddedCliConfigOptions = {
  workspacePath: string;
  themeName: string;
  themeMode: "dark" | "light";
  themeContent: string;
};

type EmbeddedCliConfig = {
  configHome: string;
  configDirectory: string;
  allowEmbeddedControlInput: boolean;
};

function writePrivateFile(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function prepareEmbeddedOpencodeCliConfig({
  workspacePath,
  themeName,
  themeMode,
  themeContent,
}: EmbeddedCliConfigOptions): EmbeddedCliConfig {
  const keybinds = mergeHiveEmbeddedBrowserSafeKeybinds();
  const configHome = join(workspacePath, ...EMBEDDED_CONFIG_HOME);
  const configDirectory = join(configHome, "opencode");
  const themeDirectory = join(configDirectory, "themes");
  mkdirSync(themeDirectory, { recursive: true });

  writePrivateFile(
    join(configDirectory, "cli.json"),
    `${JSON.stringify(
      {
        $schema: CLI_SCHEMA_URL,
        theme: { name: themeName, mode: themeMode },
        keybinds,
      },
      null,
      2
    )}\n`
  );
  writePrivateFile(join(themeDirectory, `${themeName}.json`), themeContent);

  return {
    configHome,
    configDirectory,
    allowEmbeddedControlInput: allowsEmbeddedChatControlInput(keybinds),
  };
}
