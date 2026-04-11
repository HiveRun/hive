import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type AvailableModel,
  type ModelListResponse,
  modelQueries,
} from "@/queries/models";

export type ModelSelection = {
  id: string;
  providerId: string;
  variant?: string;
  selectionSource?: ModelSelectionSource;
};

export type ModelSelectionSource = "auto" | "sticky" | "user";

const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  opencode: "Zen",
};

const DEFAULT_VARIANT_VALUE = "__default_variant__";
const MAX_INLINE_VARIANT_OPTIONS = 4;

type ProviderGroup = {
  provider: string;
  models: AvailableModel[];
};

function getVariantPreferenceKey(model: {
  providerId: string;
  modelId: string;
}) {
  return `${model.providerId}/${model.modelId}`;
}

type ModelSelectorProps = {
  id?: string;
  providerId?: string;
  sessionId?: string;
  workspaceId?: string;
  selectedModel?: ModelSelection;
  onModelChange: (model: ModelSelection, source: ModelSelectionSource) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  disabled?: boolean;
};

type LoadedModelSelectorProps = {
  id?: string;
  providerId?: string;
  selectedModel?: ModelSelection;
  onModelChange: (model: ModelSelection, source: ModelSelectionSource) => void;
  disabled?: boolean;
  modelsData: ModelListResponse;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeps model and variant selection behavior in one place
function LoadedModelSelector({
  id,
  providerId,
  selectedModel,
  onModelChange,
  disabled = false,
  modelsData,
}: LoadedModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const providerNames = useMemo(() => {
    const providers = modelsData?.providers ?? [];
    return new Map<string, string>(
      providers.map((provider) => [provider.id, provider.name ?? provider.id])
    );
  }, [modelsData?.providers]);

  const resolveProviderLabel = useCallback(
    (providerKey: string) =>
      PROVIDER_LABEL_OVERRIDES[providerKey] ??
      providerNames.get(providerKey) ??
      providerKey,
    [providerNames]
  );

  const defaultSelection = useMemo(() => {
    const defaults = modelsData?.defaults ?? {};
    if (providerId && defaults[providerId]) {
      return { providerId, modelId: defaults[providerId] };
    }
    const [entry] = Object.entries(defaults);
    if (entry) {
      const [defaultProviderId, modelId] = entry;
      return { providerId: defaultProviderId, modelId };
    }
    return null;
  }, [modelsData?.defaults, providerId]);

  const prioritizedProviderId = providerId ?? defaultSelection?.providerId;

  const groupedModels = useMemo(() => {
    if (!modelsData?.models) {
      return [] as ProviderGroup[];
    }

    const map = new Map<string, AvailableModel[]>();

    for (const model of modelsData.models) {
      const bucket = map.get(model.provider);
      if (bucket) {
        bucket.push(model);
      } else {
        map.set(model.provider, [model]);
      }
    }

    const groups = Array.from(map.entries()).map(([provider, models]) => ({
      provider,
      models: [...models].sort((a, b) => a.name.localeCompare(b.name)),
    }));

    return groups.sort((a, b) => {
      if (prioritizedProviderId) {
        if (
          a.provider === prioritizedProviderId &&
          b.provider !== prioritizedProviderId
        ) {
          return -1;
        }
        if (
          b.provider === prioritizedProviderId &&
          a.provider !== prioritizedProviderId
        ) {
          return 1;
        }
      }
      const nameA = resolveProviderLabel(a.provider);
      const nameB = resolveProviderLabel(b.provider);
      return nameA.localeCompare(nameB);
    });
  }, [modelsData?.models, prioritizedProviderId, resolveProviderLabel]);

  const flattenedModels = useMemo(
    () => groupedModels.flatMap((group) => group.models),
    [groupedModels]
  );

  useEffect(() => {
    if (!flattenedModels.length || selectedModel) {
      return;
    }
    let defaultModel: AvailableModel | undefined;
    if (defaultSelection) {
      defaultModel = flattenedModels.find(
        (model) =>
          model.id === defaultSelection.modelId &&
          model.provider === defaultSelection.providerId
      );
    }
    if (!defaultModel) {
      defaultModel = flattenedModels[0];
    }
    if (defaultModel) {
      onModelChange(
        { id: defaultModel.id, providerId: defaultModel.provider },
        "auto"
      );
    }
  }, [flattenedModels, defaultSelection, onModelChange, selectedModel]);

  const selectedEntry = selectedModel
    ? flattenedModels.find(
        (model) =>
          model.id === selectedModel.id &&
          model.provider === selectedModel.providerId
      )
    : undefined;
  const selectedVariants = selectedEntry?.variants ?? [];
  const variantPreferences = modelsData.stickyVariants;
  const selectedVariantExists = selectedModel?.variant
    ? selectedVariants.some((variant) => variant.id === selectedModel.variant)
    : true;
  const stickyVariantPreference = selectedModel
    ? variantPreferences[
        getVariantPreferenceKey({
          providerId: selectedModel.providerId,
          modelId: selectedModel.id,
        })
      ]
    : undefined;
  const inheritedVariantPreference =
    stickyVariantPreference && stickyVariantPreference !== DEFAULT_VARIANT_VALUE
      ? stickyVariantPreference
      : undefined;

  useEffect(() => {
    if (!(selectedModel && selectedEntry) || selectedVariantExists) {
      return;
    }

    onModelChange(
      {
        id: selectedModel.id,
        providerId: selectedModel.providerId,
      },
      "auto"
    );
  }, [onModelChange, selectedEntry, selectedModel, selectedVariantExists]);

  useEffect(() => {
    if (!(selectedModel && selectedEntry) || selectedModel.variant) {
      return;
    }

    if (
      !stickyVariantPreference ||
      stickyVariantPreference === DEFAULT_VARIANT_VALUE
    ) {
      return;
    }

    const variantExists = selectedVariants.some(
      (variant) => variant.id === stickyVariantPreference
    );
    if (!variantExists) {
      return;
    }

    onModelChange(
      {
        id: selectedModel.id,
        providerId: selectedModel.providerId,
        variant: stickyVariantPreference,
        selectionSource: "sticky",
      },
      "sticky"
    );
  }, [
    onModelChange,
    selectedEntry,
    selectedModel,
    selectedVariants,
    stickyVariantPreference,
  ]);

  const handleSelect = useCallback(
    (model: AvailableModel) => {
      onModelChange({ id: model.id, providerId: model.provider }, "user");
      setOpen(false);
    },
    [onModelChange]
  );

  const handleVariantChange = useCallback(
    (value: string) => {
      if (!selectedModel) {
        return;
      }

      onModelChange(
        {
          id: selectedModel.id,
          providerId: selectedModel.providerId,
          ...(value === DEFAULT_VARIANT_VALUE ? {} : { variant: value }),
          selectionSource: value === DEFAULT_VARIANT_VALUE ? "auto" : "user",
        },
        "user"
      );
    },
    [onModelChange, selectedModel]
  );

  const selectedProviderLabel = selectedModel
    ? resolveProviderLabel(selectedModel.providerId)
    : null;
  const displayedVariant = selectedModel?.variant ?? inheritedVariantPreference;
  const variantSelectionMode =
    displayedVariant && selectedModel?.selectionSource !== "sticky"
      ? "pinned"
      : "default";
  let variantBadgeLabel = "Default";
  if (variantSelectionMode === "pinned") {
    variantBadgeLabel = "Pinned";
  } else if (inheritedVariantPreference) {
    variantBadgeLabel = "Inherited";
  }
  const variantSummary = displayedVariant ?? "OpenCode default";
  const useVariantPills = selectedVariants.length <= MAX_INLINE_VARIANT_OPTIONS;
  let variantSourceLabel = "OpenCode default";
  if (selectedModel?.selectionSource === "sticky") {
    variantSourceLabel = "From OpenCode history";
  } else if (selectedModel?.variant) {
    variantSourceLabel = "Explicitly selected";
  }
  let selectedModelLabel = "Select model...";
  if (selectedEntry) {
    selectedModelLabel = selectedEntry.name;
  } else if (selectedModel) {
    selectedModelLabel = selectedModel.id;
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-expanded={open}
            className="h-auto w-full items-center justify-between gap-3 border-border bg-background px-3 py-2.5"
            disabled={disabled}
            id={id}
            role="combobox"
            variant="outline"
          >
            <div className="flex min-w-0 flex-col items-start gap-1 text-left leading-tight">
              <span
                className={cn(
                  "truncate font-medium",
                  selectedModel ? undefined : "text-muted-foreground"
                )}
              >
                {selectedModelLabel}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                {selectedProviderLabel ? (
                  <span>{selectedProviderLabel}</span>
                ) : null}
                {selectedEntry && selectedVariants.length > 0 ? (
                  <>
                    <span>{variantSummary}</span>
                    <Badge variant="outline">{variantBadgeLabel}</Badge>
                  </>
                ) : null}
              </div>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search models..." />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              {groupedModels.map((group) => {
                const heading = resolveProviderLabel(group.provider);
                return (
                  <CommandGroup heading={heading} key={group.provider}>
                    {group.models.map((model) => {
                      const isSelected =
                        selectedModel?.id === model.id &&
                        selectedModel.providerId === model.provider;
                      return (
                        <CommandItem
                          key={`${model.provider}-${model.id}`}
                          onSelect={() => handleSelect(model)}
                          value={`${model.provider}-${model.id}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              isSelected ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{model.name}</span>
                            <span className="text-muted-foreground text-xs">
                              {model.provider}/{model.id}
                            </span>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedEntry && selectedVariants.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.12em]">
            <span>Variant</span>
            <span>{variantSourceLabel}</span>
          </div>

          {useVariantPills ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {inheritedVariantPreference ? null : (
                <Button
                  className="h-7 px-2.5 text-xs"
                  disabled={disabled}
                  onClick={() => handleVariantChange(DEFAULT_VARIANT_VALUE)}
                  size="sm"
                  type="button"
                  variant={selectedModel?.variant ? "outline" : "secondary"}
                >
                  Default
                </Button>
              )}
              {selectedVariants.map((variant) => (
                <Button
                  className="h-7 px-2.5 text-xs"
                  disabled={disabled}
                  key={variant.id}
                  onClick={() => handleVariantChange(variant.id)}
                  size="sm"
                  type="button"
                  variant={
                    displayedVariant === variant.id ? "secondary" : "outline"
                  }
                >
                  {variant.id}
                </Button>
              ))}
            </div>
          ) : (
            <Select
              disabled={disabled}
              onValueChange={handleVariantChange}
              value={displayedVariant ?? DEFAULT_VARIANT_VALUE}
            >
              <SelectTrigger className="h-8 w-full bg-background sm:w-[180px]">
                <SelectValue placeholder="Select variant" />
              </SelectTrigger>
              <SelectContent>
                {inheritedVariantPreference ? null : (
                  <SelectItem value={DEFAULT_VARIANT_VALUE}>
                    OpenCode default
                  </SelectItem>
                )}
                {selectedVariants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {variant.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ModelSelector({
  id,
  providerId,
  sessionId,
  workspaceId,
  selectedModel,
  onModelChange,
  onLoadingChange,
  disabled = false,
}: ModelSelectorProps) {
  if (!(sessionId || workspaceId)) {
    throw new Error("ModelSelector requires a sessionId or workspaceId");
  }

  const queryOptions = sessionId
    ? modelQueries.bySession(sessionId)
    : modelQueries.byWorkspace(workspaceId as string);

  const {
    data: modelsData,
    isLoading,
    isError,
  } = useQuery<ModelListResponse>(queryOptions);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  if (isLoading) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-muted-foreground text-sm">
        Loading models...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-muted px-3 py-2 text-destructive text-xs">
        Failed to load models
      </div>
    );
  }

  if (!modelsData?.models.length) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-muted px-3 py-2 text-muted-foreground text-xs">
        No models available
      </div>
    );
  }

  return (
    <LoadedModelSelector
      disabled={disabled}
      id={id}
      modelsData={modelsData}
      onModelChange={onModelChange}
      providerId={providerId}
      selectedModel={selectedModel}
    />
  );
}
