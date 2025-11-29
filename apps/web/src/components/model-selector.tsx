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
import { type AvailableModel, modelQueries } from "@/queries/models";

const ROUTER_PROVIDER_IDS = new Set(["opencode"]);
const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  opencode: "Zen",
};

type ProviderGroup = {
  provider: string;
  models: AvailableModel[];
};

type ModelSelectorProps = {
  id?: string;
  providerId: string;
  sessionId: string;
  selectedModelId?: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
};

export function ModelSelector({
  id,
  providerId,
  sessionId,
  selectedModelId,
  onModelChange,
  disabled = false,
}: ModelSelectorProps) {
  const {
    data: modelsData,
    isLoading,
    isError,
  } = useQuery(modelQueries.bySession(sessionId));
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

  const includeAllProviders = ROUTER_PROVIDER_IDS.has(providerId);

  const groupedModels = useMemo(() => {
    if (!modelsData?.models) {
      return [] as ProviderGroup[];
    }

    const map = new Map<string, AvailableModel[]>();

    for (const model of modelsData.models) {
      if (!includeAllProviders && model.provider !== providerId) {
        continue;
      }
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
      if (a.provider === providerId) {
        return -1;
      }
      if (b.provider === providerId) {
        return 1;
      }
      const nameA = resolveProviderLabel(a.provider);
      const nameB = resolveProviderLabel(b.provider);
      return nameA.localeCompare(nameB);
    });
  }, [
    includeAllProviders,
    modelsData?.models,
    providerId,
    resolveProviderLabel,
  ]);

  const flattenedModels = useMemo(
    () => groupedModels.flatMap((group) => group.models),
    [groupedModels]
  );

  useEffect(() => {
    if (!(sessionId && flattenedModels.length) || selectedModelId) {
      return;
    }
    const defaultModelId =
      modelsData?.defaults?.[providerId] ?? flattenedModels[0]?.id;
    if (defaultModelId) {
      onModelChange(defaultModelId);
    }
  }, [
    flattenedModels,
    modelsData?.defaults,
    onModelChange,
    providerId,
    selectedModelId,
    sessionId,
  ]);

  const selectedModel = flattenedModels.find(
    (model) => model.id === selectedModelId
  );

  const handleSelect = useCallback(
    (modelId: string) => {
      onModelChange(modelId);
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

  const emptyLabel = includeAllProviders
    ? "No models available"
    : `No models available for ${providerId}`;

  if (!flattenedModels.length) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-muted px-3 py-2 text-muted-foreground text-xs">
        {emptyLabel}
      </div>
    );
  }

  const selectedLabel = selectedModel
    ? `${resolveProviderLabel(selectedModel.provider)} · ${selectedModel.name}`
    : "Select model...";

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
          id={id}
          role="combobox"
          variant="outline"
        >
          {selectedLabel}
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
                      selectedModel.provider === model.provider;
                    return (
                      <CommandItem
                        key={`${model.provider}-${model.id}`}
                        onSelect={handleSelect}
                        value={model.id}
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
