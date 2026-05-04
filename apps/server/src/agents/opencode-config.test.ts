import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadEffectiveOpencodeDefaults,
  loadOpencodeConfig,
} from "./opencode-config";

const createdDirs: string[] = [];

const createWorkspace = async (): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), "hive-opencode-config-"));
  createdDirs.push(workspace);
  return workspace;
};

const writeWorkspaceOpencodeConfig = async (
  workspace: string,
  config: Record<string, unknown>
) => {
  await writeFile(
    join(workspace, "@opencode.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
};

const readKeybind = (
  config: Record<string, unknown>,
  key: string
): string | undefined => {
  const candidate = config.keybinds;
  if (!candidate || typeof candidate !== "object") {
    return;
  }

  const value = (candidate as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    return;
  }

  return value;
};

afterEach(async () => {
  while (createdDirs.length > 0) {
    const directory = createdDirs.pop();
    if (!directory) {
      continue;
    }

    await rm(directory, { recursive: true, force: true });
  }
});

describe("loadOpencodeConfig", () => {
  it("adds Hive browser-safe keybind defaults when no workspace config exists", async () => {
    const loadedConfig = await loadWorkspaceConfig();

    expect(readKeybind(loadedConfig, "leader")).toBe("ctrl+x");
    expect(readKeybind(loadedConfig, "app_exit")).toBe(
      "ctrl+c,ctrl+d,<leader>q"
    );
    expect(readKeybind(loadedConfig, "display_thinking")).toBe("<leader>i");
    expect(readKeybind(loadedConfig, "command_list")).toBe("<leader>p");
    expect(readKeybind(loadedConfig, "theme_list")).toBe("<leader>j");
    expect(readKeybind(loadedConfig, "variant_cycle")).toBe("<leader>t");
    expect(readKeybind(loadedConfig, "session_rename")).toBe("<leader>k");
    expect(readKeybind(loadedConfig, "model_favorite_toggle")).toBe(
      "<leader>o"
    );
    expect(readKeybind(loadedConfig, "input_delete_word_backward")).toBe(
      "ctrl+backspace,alt+backspace"
    );
    expect(loadedConfig.theme).toBe("hive-resonant");
    expect(loadedConfig.instructions).toEqual([".hive/instructions.md"]);
  });

  it("preserves workspace keybind overrides and appends Hive aliases", async () => {
    const loadedConfig = await loadWorkspaceConfig({
      keybinds: {
        leader: "ctrl+g",
        command_list: "ctrl+space",
      },
    });

    expect(readKeybind(loadedConfig, "command_list")).toBe(
      "ctrl+space,<leader>p"
    );
    expect(readKeybind(loadedConfig, "leader")).toBe("ctrl+g");
    expect(readKeybind(loadedConfig, "variant_cycle")).toBe("<leader>t");
    expect(readKeybind(loadedConfig, "display_thinking")).toBe("<leader>i");
  });

  it("respects explicit none values in workspace keybinds", async () => {
    const loadedConfig = await loadWorkspaceConfig({
      keybinds: {
        variant_cycle: "none",
      },
    });

    expect(readKeybind(loadedConfig, "variant_cycle")).toBe("none");
  });

  it("keeps unrelated workspace keybinds and fills missing Hive aliases", async () => {
    const loadedConfig = await loadWorkspaceConfig({
      keybinds: {
        tips_toggle: "none",
      },
      theme: "custom-workspace-theme",
    });

    expect(readKeybind(loadedConfig, "tips_toggle")).toBe("none");
    expect(readKeybind(loadedConfig, "model_favorite_toggle")).toBe(
      "<leader>o"
    );
    expect(readKeybind(loadedConfig, "session_rename")).toBe("<leader>k");
    expect(loadedConfig.theme).toBe("custom-workspace-theme");
  });

  it("appends Hive instructions once when workspace config already includes them", async () => {
    const loadedConfig = await loadWorkspaceConfig({
      instructions: [".hive/instructions.md", "docs/custom.md"],
    });
    expect(loadedConfig.instructions).toEqual([
      ".hive/instructions.md",
      "docs/custom.md",
    ]);
  });
});

describe("loadEffectiveOpencodeDefaults", () => {
  it("reads the effective default model from OpenCode config", async () => {
    await expectDefaults(
      {
        model: "openai/gpt-5.4-xhigh",
        default_agent: "plan",
        agent: {
          plan: {
            variant: "high",
          },
        },
      },
      { modelId: "gpt-5.4-xhigh", startMode: "plan", variant: "high" }
    );
  });

  it("prefers the active agent model and variant over the root model", async () => {
    await expectDefaults(
      {
        model: "openai/gpt-5.4",
        default_agent: "build",
        agent: {
          build: {
            model: "openai/gpt-5.5",
            variant: "xhigh",
          },
        },
      },
      { modelId: "gpt-5.5", startMode: "build", variant: "xhigh" }
    );
  });

  it("returns an empty object when OpenCode exposes no model or start mode", async () => {
    const client = makeOpencodeClient({});

    const defaults = await loadEffectiveOpencodeDefaults("/tmp/workspace", {
      client,
    });

    expect(defaults).toEqual({});
  });
});

async function loadWorkspaceConfig(config?: Record<string, unknown>) {
  const workspace = await createWorkspace();
  if (config) {
    await writeWorkspaceOpencodeConfig(workspace, config);
  }

  const loaded = await loadOpencodeConfig(workspace);
  return loaded.config as Record<string, unknown>;
}

function makeOpencodeClient(data: Record<string, unknown>) {
  return {
    config: {
      get: async () => ({ data }),
    },
  } as any;
}

async function expectDefaults(
  data: Record<string, unknown>,
  expected: { modelId: string; startMode: string; variant: string }
) {
  const defaults = await loadEffectiveOpencodeDefaults("/tmp/workspace", {
    client: makeOpencodeClient(data),
  });

  const actual = defaults as {
    defaultModel?: { providerId?: string; modelId?: string; variant?: string };
    startMode?: string;
  };

  if (
    actual.defaultModel?.providerId !== "openai" ||
    actual.defaultModel.modelId !== expected.modelId ||
    actual.defaultModel.variant !== expected.variant ||
    actual.startMode !== expected.startMode
  ) {
    throw new Error(
      `Expected defaults for ${expected.modelId}/${expected.variant}/${expected.startMode}, got ${JSON.stringify(defaults)}`
    );
  }
}
