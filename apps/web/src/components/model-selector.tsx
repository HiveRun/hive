import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  type AvailableModel,
  type ModelListResponse,
  modelQueries,
} from "@/queries/models";

export type ModelSelection = {
  id: string;
  providerId: string;
};

const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  opencode: "Zen",
};

type ProviderGroup = {
  provider: string;
  models: AvailableModel[];
};

type ModelSelectorProps = {
  id?: string;
  providerId?: string;
  sessionId?: string;
  workspaceId?: string;
  selectedModel?: ModelSelection;
  onModelChange: (model: ModelSelection) => void;
  disabled?: boolean;
};

export function ModelSelector({
  id,
  providerId,
  sessionId,
  workspaceId,
  selectedModel,
  onModelChange,
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
      onModelChange({ id: defaultModel.id, providerId: defaultModel.provider });
    }
  }, [flattenedModels, defaultSelection, onModelChange, selectedModel]);

  const selectedEntry = selectedModel
    ? flattenedModels.find(
        (model) =>
          model.id === selectedModel.id &&
          model.provider === selectedModel.providerId
      )
    : undefined;

  const handleSelect = useCallback(
    (model: AvailableModel) => {
      onModelChange({ id: model.id, providerId: model.provider });
      setOpen(false);
    },
    [onModelChange]
  );

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

  if (!flattenedModels.length) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-muted px-3 py-2 text-muted-foreground text-xs">
        No models available
      </div>
    );
  }

  const selectedProviderLabel = selectedModel
    ? resolveProviderLabel(selectedModel.providerId)
    : null;
  let selectedModelLabel = "Select model...";
  if (selectedEntry) {
    selectedModelLabel = selectedEntry.name;
  } else if (selectedModel) {
    selectedModelLabel = selectedModel.id;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="w-full items-center justify-between gap-2"
          disabled={disabled}
          id={id}
          role="combobox"
          variant="outline"
        >
          <div className="flex flex-col items-start text-left leading-tight">
            <span
              className={cn(
                "font-medium",
                selectedModel ? undefined : "text-muted-foreground"
              )}
            >
              {selectedModelLabel}
            </span>
            {selectedProviderLabel ? (
              <span className="text-[0.65rem] text-muted-foreground uppercase tracking-wide">
                {selectedProviderLabel}
              </span>
            ) : null}
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
  );
}
