import type { AgentDefaults, Template } from "@/queries/templates";
import type { ModelSelection } from "./model-selector";

export function isSameModelSelection(
  current?: ModelSelection,
  next?: ModelSelection
): boolean {
  if (!(current && next)) {
    return false;
  }

  return current.id === next.id && current.providerId === next.providerId;
}

export function resolveTemplateModelSelection(
  template: Template | undefined,
  agentDefaults: AgentDefaults | undefined
): ModelSelection | undefined {
  const agentConfig = template?.configJson.agent;
  if (agentConfig?.modelId) {
    return { id: agentConfig.modelId, providerId: agentConfig.providerId };
  }

  const defaultModelId = agentDefaults?.modelId;
  const defaultProviderId = agentDefaults?.providerId;
  const templateProviderId = agentConfig?.providerId;

  const providerCompatible =
    !(templateProviderId && defaultProviderId) ||
    templateProviderId === defaultProviderId;

  if (defaultModelId && providerCompatible) {
    const providerId = templateProviderId ?? defaultProviderId;
    if (providerId) {
      return { id: defaultModelId, providerId };
    }
  }

  return;
}

export function resolveAutoSelectedModel(args: {
  activeTemplate: Template | undefined;
  agentDefaults: AgentDefaults | undefined;
  currentSelection: ModelSelection | undefined;
  hasExplicitModelSelection: boolean;
}): ModelSelection | undefined {
  if (!args.activeTemplate || args.hasExplicitModelSelection) {
    return args.currentSelection;
  }

  const nextSelection = resolveTemplateModelSelection(
    args.activeTemplate,
    args.agentDefaults
  );

  if (
    !nextSelection ||
    isSameModelSelection(args.currentSelection, nextSelection)
  ) {
    return args.currentSelection;
  }

  return nextSelection;
}
