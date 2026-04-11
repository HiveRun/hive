import type { AgentDefaults, Template } from "@/queries/templates";
import type { ModelSelection } from "./model-selector";

function resolveTemplateAgentModel(template: Template | undefined) {
  const agentConfig = template?.configJson.agent;
  if (!agentConfig) {
    return;
  }

  if (agentConfig.model) {
    return {
      providerId: agentConfig.model.providerId,
      modelId: agentConfig.model.id,
      variant: agentConfig.model.variant,
    };
  }

  if (!(agentConfig.providerId && agentConfig.modelId)) {
    return;
  }

  return {
    providerId: agentConfig.providerId,
    modelId: agentConfig.modelId,
    variant: agentConfig.variant,
  };
}

function resolveTemplateAgentProvider(template: Template | undefined) {
  const agentConfig = template?.configJson.agent;
  return agentConfig?.model?.providerId ?? agentConfig?.providerId;
}

export function isSameModelSelection(
  current?: ModelSelection,
  next?: ModelSelection
): boolean {
  if (!(current && next)) {
    return false;
  }

  return (
    current.id === next.id &&
    current.providerId === next.providerId &&
    current.variant === next.variant
  );
}

export function resolveTemplateModelSelection(
  template: Template | undefined,
  agentDefaults: AgentDefaults | undefined
): ModelSelection | undefined {
  const templateModel = resolveTemplateAgentModel(template);
  if (templateModel) {
    return {
      id: templateModel.modelId,
      providerId: templateModel.providerId,
      ...(templateModel.variant ? { variant: templateModel.variant } : {}),
    };
  }

  const defaultModelId = agentDefaults?.modelId;
  const defaultProviderId = agentDefaults?.providerId;
  const templateProviderId = resolveTemplateAgentProvider(template);

  const providerCompatible =
    !(templateProviderId && defaultProviderId) ||
    templateProviderId === defaultProviderId;

  if (defaultModelId && providerCompatible) {
    const providerId = templateProviderId ?? defaultProviderId;
    if (providerId) {
      return {
        id: defaultModelId,
        providerId,
        ...(agentDefaults?.variant ? { variant: agentDefaults.variant } : {}),
      };
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
