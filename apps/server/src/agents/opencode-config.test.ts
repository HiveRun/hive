import type { ConfigEntry } from "@opencode-ai/client";
import { describe, expect, it } from "vitest";
import { loadEffectiveOpencodeDefaults } from "./opencode-config";

describe("loadEffectiveOpencodeDefaults", () => {
  it("reads the effective root model from ordered v2 config entries", async () => {
    const defaults = await loadDefaults([
      document({ model: "openai/gpt-5.4#high", default_agent: "plan" }),
    ]);

    expect(defaults).toEqual({
      defaultModel: {
        providerId: "openai",
        modelId: "gpt-5.4",
        variant: "high",
      },
      startMode: "plan",
    });
  });

  it("prefers the active agent model over the root model", async () => {
    const defaults = await loadDefaults([
      document({ model: "openai/gpt-5.4" }),
      document({
        default_agent: "build",
        agents: { build: { model: "openai/gpt-5.5#xhigh" } },
      }),
    ]);

    expect(defaults).toEqual({
      defaultModel: {
        providerId: "openai",
        modelId: "gpt-5.5",
        variant: "xhigh",
      },
      startMode: "build",
    });
  });

  it("supports structured native model references", async () => {
    const defaults = await loadDefaults([
      document({
        model: {
          providerID: "anthropic",
          model: "claude-sonnet-4-5",
          variant: "high",
        },
      }),
    ]);

    expect(defaults).toEqual({
      defaultModel: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
        variant: "high",
      },
    });
  });

  it("returns an empty object when OpenCode exposes no model or start mode", async () => {
    const defaults = await loadEffectiveOpencodeDefaults("/tmp/workspace", {
      client: makeOpencodeClient([]),
    });

    expect(defaults).toEqual({});
  });
});

function document(
  info: Extract<ConfigEntry, { type: "document" }>["info"]
): ConfigEntry {
  return { type: "document", info };
}

function makeOpencodeClient(entries: ConfigEntry[]) {
  return {
    config: {
      get: async () => entries,
    },
  } as any;
}

async function loadDefaults(entries: ConfigEntry[]) {
  return await loadEffectiveOpencodeDefaults("/tmp/workspace", {
    client: makeOpencodeClient(entries),
  });
}
