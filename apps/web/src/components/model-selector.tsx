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

  const availableModels = useMemo(() => {
    if (!modelsData?.models) {
      return [] as AvailableModel[];
    }
    return modelsData.models.filter((model) => model.provider === providerId);
  }, [modelsData?.models, providerId]);

  useEffect(() => {
    if (!(sessionId && availableModels.length) || selectedModelId) {
      return;
    }
    const defaultModelId =
      modelsData?.defaults?.[providerId] ?? availableModels[0]?.id;
    if (defaultModelId) {
      onModelChange(defaultModelId);
    }
  }, [
    availableModels,
    modelsData?.defaults,
    onModelChange,
    providerId,
    selectedModelId,
    sessionId,
  ]);

  const selectedModel = availableModels.find(
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

  if (!availableModels.length) {
    return (
      <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-muted px-3 py-2 text-muted-foreground text-xs">
        No models available for {providerId}
      </div>
    );
  }

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
          {selectedModel ? selectedModel.name : "Select model..."}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {availableModels.map((model) => (
                <CommandItem
                  key={model.id}
                  onSelect={handleSelect}
                  value={model.id}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      model.id === selectedModelId ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{model.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {model.provider}/{model.id}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
