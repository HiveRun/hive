import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareEmbeddedOpencodeCliConfig } from "./embedded-cli-config";

const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "hive-embedded-cli-"));
  temporaryDirectories.add(directory);
  return directory;
}

function removeTemporaryDirectories(): void {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
}

afterEach(() => {
  removeTemporaryDirectories();
});

describe("embedded OpenCode CLI config", () => {
  it("writes only Hive-owned browser-safe settings", () => {
    const root = createTemporaryDirectory();
    const workspacePath = join(root, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });

    const prepared = prepareEmbeddedOpencodeCliConfig({
      workspacePath,
      themeName: "hive-test",
      themeMode: "light",
      themeContent: "{}\n",
    });
    const embeddedConfig = JSON.parse(
      fs.readFileSync(join(prepared.configDirectory, "cli.json"), "utf8")
    );

    expect(prepared.configDirectory).toBe(
      join(workspacePath, ".opencode", "state", "xdg", "config", "opencode")
    );
    expect(embeddedConfig).toMatchObject({
      $schema: "https://opencode.ai/v2/cli.json",
      theme: { name: "hive-test", mode: "light" },
      keybinds: {
        "app.exit": "<leader>q",
        "command.palette.show": "<leader>p",
        "variant.cycle": "<leader>t",
      },
    });
    expect(
      fs.readFileSync(
        join(prepared.configDirectory, "themes", "hive-test.json"),
        "utf8"
      )
    ).toBe("{}\n");
    expect(prepared.allowEmbeddedControlInput).toBe(false);
  });
});
