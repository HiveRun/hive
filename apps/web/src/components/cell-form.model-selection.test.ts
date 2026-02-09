import { describe, expect, it } from "vitest";
import {
  resolveAutoSelectedModel,
  resolveTemplateModelSelection,
} from "./cell-form.model-selection";

const templateWithAgentModel = {
  configJson: {
    agent: {
      modelId: "big-pickle",
      providerId: "opencode",
    },
  },
  id: "t-1",
  label: "Template 1",
  type: "manual",
};

describe("cell form model selection", () => {
  it("prefers explicit template agent model when present", () => {
    const selection = resolveTemplateModelSelection(templateWithAgentModel, {
      modelId: "workspace-default",
      providerId: "opencode",
    });

    expect(selection).toEqual({
      id: "big-pickle",
      providerId: "opencode",
    });
  });

  it("falls back to workspace agent defaults when template omits model", () => {
    const selection = resolveTemplateModelSelection(
      {
        ...templateWithAgentModel,
        configJson: {
          agent: {
            providerId: "opencode",
          },
        },
      },
      {
        modelId: "big-pickle",
        providerId: "opencode",
      }
    );

    expect(selection).toEqual({
      id: "big-pickle",
      providerId: "opencode",
    });
  });

  it("ignores workspace defaults when provider is incompatible", () => {
    const selection = resolveTemplateModelSelection(
      {
        ...templateWithAgentModel,
        configJson: {
          agent: {
            providerId: "openai",
          },
        },
      },
      {
        modelId: "big-pickle",
        providerId: "opencode",
      }
    );

    expect(selection).toBeUndefined();
  });

  it("keeps user-selected model when auto-selection reruns", () => {
    const selection = resolveAutoSelectedModel({
      activeTemplate: templateWithAgentModel,
      agentDefaults: {
        modelId: "big-pickle",
        providerId: "opencode",
      },
      currentSelection: {
        id: "gpt-5.3-codex",
        providerId: "openai",
      },
      hasExplicitModelSelection: true,
    });

    expect(selection).toEqual({
      id: "gpt-5.3-codex",
      providerId: "openai",
    });
  });

  it("applies template default when there is no explicit user selection", () => {
    const selection = resolveAutoSelectedModel({
      activeTemplate: templateWithAgentModel,
      agentDefaults: {
        modelId: "big-pickle",
        providerId: "opencode",
      },
      currentSelection: {
        id: "gpt-5.3-codex",
        providerId: "openai",
      },
      hasExplicitModelSelection: false,
    });

    expect(selection).toEqual({
      id: "big-pickle",
      providerId: "opencode",
    });
  });
});
