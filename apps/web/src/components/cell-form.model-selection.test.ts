import { describe, expect, it } from "vitest";
import type { AgentDefaults, Template } from "@/queries/templates";
import {
  resolveAutoSelectedModel,
  resolveTemplateModelSelection,
} from "./cell-form.model-selection";

const OPENCODE_DEFAULTS = {
  modelId: "big-pickle",
  providerId: "opencode",
} satisfies AgentDefaults;
const OPENCODE_BALANCED_DEFAULTS = {
  ...OPENCODE_DEFAULTS,
  variant: "balanced",
} satisfies AgentDefaults;
const OPENAI_SELECTION = {
  id: "gpt-5.3-codex",
  providerId: "openai",
};
const OPENCODE_HIGH_SELECTION = {
  id: "big-pickle",
  providerId: "opencode",
  variant: "high",
};
const OPENCODE_BALANCED_SELECTION = {
  id: "big-pickle",
  providerId: "opencode",
  variant: "balanced",
};

const buildTemplate = (
  agent: NonNullable<Template["configJson"]["agent"]>
): Template => ({
  configJson: {
    agent,
  },
  id: "t-1",
  label: "Template 1",
  type: "manual",
});

const templateWithAgentModel = buildTemplate({
  model: {
    id: "big-pickle",
    providerId: "opencode",
    variant: "high",
  },
});

const templatePinnedToOpencode = buildTemplate({ providerId: "opencode" });

const resolveAutoSelection = (hasExplicitModelSelection: boolean) =>
  resolveAutoSelectedModel({
    activeTemplate: templateWithAgentModel,
    agentDefaults: OPENCODE_DEFAULTS,
    currentSelection: OPENAI_SELECTION,
    hasExplicitModelSelection,
  });

describe("cell form model selection", () => {
  it("prefers explicit template agent model when present", () => {
    const selection = resolveTemplateModelSelection(
      templateWithAgentModel,
      OPENCODE_DEFAULTS
    );

    expect(selection).toEqual(OPENCODE_HIGH_SELECTION);
  });

  it("falls back to workspace agent defaults when template omits model", () => {
    const selection = resolveTemplateModelSelection(
      templatePinnedToOpencode,
      OPENCODE_BALANCED_DEFAULTS
    );

    expect(selection).toEqual(OPENCODE_BALANCED_SELECTION);
  });

  it("ignores workspace defaults when provider is incompatible", () => {
    const selection = resolveTemplateModelSelection(
      buildTemplate({ providerId: "openai" }),
      OPENCODE_DEFAULTS
    );

    expect(selection).toBeUndefined();
  });

  it("keeps user-selected model when auto-selection reruns", () => {
    expect(resolveAutoSelection(true)).toEqual(OPENAI_SELECTION);
  });

  it("applies template default when there is no explicit user selection", () => {
    expect(resolveAutoSelection(false)).toEqual(OPENCODE_HIGH_SELECTION);
  });

  it("uses workspace default variant when template only pins provider", () => {
    const selection = resolveTemplateModelSelection(
      templatePinnedToOpencode,
      OPENCODE_BALANCED_DEFAULTS
    );

    expect(selection).toEqual(OPENCODE_BALANCED_SELECTION);
  });
});
