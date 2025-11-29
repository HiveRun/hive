import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CreateCellInput } from "@/lib/rpc";
import { cellMutations } from "@/queries/cells";
import { type Template, templateQueries } from "@/queries/templates";

type CellFormValues = CreateCellInput;

const NAME_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 1000;

const cellSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(NAME_MAX_LENGTH, "Name too long"),
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, "Description too long")
    .optional(),
  templateId: z.string().min(1, "Template is required"),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
});

const validateName = (value: string) => {
  const result = cellSchema.shape.name.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid name";
  }
};

const validateDescription = (value: string) => {
  const result = cellSchema.shape.description.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid description";
  }
};

const validateTemplateId = (value: string) => {
  const result = cellSchema.shape.templateId.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Template is required";
  }
};

type CellFormProps = {
  workspaceId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function CellForm({ workspaceId, onSuccess, onCancel }: CellFormProps) {
  const queryClient = useQueryClient();

  const {
    data: templatesData,
    isLoading: templatesLoading,
    error: templatesError,
  } = useQuery(templateQueries.all(workspaceId));

  const templates = templatesData?.templates;
  const defaults = templatesData?.defaults;
  const agentDefaults = templatesData?.agentDefaults;

  const defaultValues = useMemo(
    () => ({
      name: "",
      description: "",
      templateId: defaults?.templateId ?? "",
      modelId: undefined,
      providerId: undefined,
    }),
    [defaults?.templateId]
  );

  const [activeTemplateId, setActiveTemplateId] = useState(
    defaultValues.templateId
  );
  const [selectedModel, setSelectedModel] = useState<ModelSelection>();

  useEffect(() => {
    setActiveTemplateId(defaultValues.templateId);
    setSelectedModel(undefined);
  }, [defaultValues.templateId]);

  const activeTemplate = templates?.find(
    (template) => template.id === activeTemplateId
  );
  const templateAgent = activeTemplate?.configJson.agent;
  const providerPreference =
    selectedModel?.providerId ?? templateAgent?.providerId;

  const resolveTemplateModelSelection = useCallback(
    (template?: Template) => {
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
    },
    [agentDefaults]
  );

  useEffect(() => {
    if (!activeTemplate || selectedModel) {
      return;
    }

    const nextSelection = resolveTemplateModelSelection(activeTemplate);
    if (nextSelection) {
      setSelectedModel(nextSelection);
    }
  }, [activeTemplate, resolveTemplateModelSelection, selectedModel]);

  const mutation = useMutation({
    mutationFn: cellMutations.create.mutationFn,
    onSuccess: (cell) => {
      if (cell.status === "error") {
        toast.warning("Cell created with setup errors", {
          description:
            cell.lastSetupError ??
            "Open the cell to rerun the setup commands manually.",
        });
      } else {
        toast.success("Cell created successfully");
      }

      queryClient.invalidateQueries({ queryKey: ["cells", workspaceId] });
      form.reset();
      setSelectedModel(undefined);
      setActiveTemplateId(defaultValues.templateId);
      onSuccess?.();
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to create cell";
      const [headline, ...rest] = message.split("\n");
      const description = rest.join("\n").trim();
      toast.error(headline || "Failed to create cell", {
        description: description || undefined,
      });
    },
  });

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      const formValues = value as CellFormValues;
      mutation.mutate({
        ...formValues,
        workspaceId,
        modelId: selectedModel?.id ?? formValues.modelId,
        providerId: selectedModel?.providerId ?? formValues.providerId,
      });
    },
  });

  const handleModelChange = (model: ModelSelection) => {
    setSelectedModel(model);
  };

  const mutationErrorMessage =
    mutation.error instanceof Error ? mutation.error.message : undefined;

  if (templatesLoading) {
    return <div>Loading templates...</div>;
  }

  if (templatesError) {
    const message =
      templatesError instanceof Error
        ? templatesError.message
        : "Failed to load templates";
    return (
      <div className="text-red-600">Error loading templates: {message}</div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <div>
        No templates available. Add templates in hive.config.ts to continue.
      </div>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Create New Cell</CardTitle>
      </CardHeader>
      <CardContent>
        {mutation.isError && mutationErrorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive text-sm">
            <p className="font-semibold">Cell creation failed</p>
            <pre className="mt-2 whitespace-pre-wrap text-destructive text-xs">
              {mutationErrorMessage}
            </pre>
          </div>
        )}
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => validateName(value),
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Name</Label>
                <Input
                  disabled={mutation.isPending}
                  id={field.name}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Enter cell name"
                  value={field.state.value}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-red-600 text-sm">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="description"
            validators={{
              onChange: ({ value }) => validateDescription(value),
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Description</Label>
                <Textarea
                  disabled={mutation.isPending}
                  id={field.name}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Enter cell description (optional)"
                  rows={3}
                  value={field.state.value}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-red-600 text-sm">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="templateId"
            validators={{
              onChange: ({ value }) => validateTemplateId(value),
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Template</Label>
                <div data-testid="template-select">
                  <Select
                    disabled={mutation.isPending}
                    onValueChange={(value) => {
                      field.handleChange(value);
                      setActiveTemplateId(value);
                      const nextTemplate = templates?.find(
                        (template) => template.id === value
                      );
                      const nextSelection =
                        resolveTemplateModelSelection(nextTemplate);
                      setSelectedModel(nextSelection);
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.isArray(templates) &&
                        templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-red-600 text-sm">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="space-y-2">
            <Label htmlFor="cell-model-selector">Model</Label>
            <ModelSelector
              disabled={mutation.isPending}
              id="cell-model-selector"
              onModelChange={handleModelChange}
              providerId={providerPreference}
              selectedModel={selectedModel}
              workspaceId={workspaceId}
            />
            <p className="text-muted-foreground text-xs">
              Sets the provider/model used when the cell's agent session starts.
            </p>
          </div>

          <div className="flex justify-end space-x-2">
            {onCancel && (
              <Button
                disabled={mutation.isPending}
                onClick={onCancel}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            )}
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Creating..." : "Create Cell"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
