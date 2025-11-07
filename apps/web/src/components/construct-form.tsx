import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import type { CreateConstructInput, UpdateConstructInput } from "@/lib/rpc";
import {
  constructMutations,
  type constructQueries,
} from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

// Infer Construct type from query return type
type Construct = Awaited<
  ReturnType<ReturnType<typeof constructQueries.detail>["queryFn"]>
>;
type ConstructFormValues = CreateConstructInput;

const NAME_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 1000;

const constructSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(NAME_MAX_LENGTH, "Name too long"),
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, "Description too long")
    .optional(),
  templateId: z.string().min(1, "Template is required"),
});

const validateName = (value: string) => {
  const result = constructSchema.shape.name.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid name";
  }
};

const validateDescription = (value: string) => {
  const result = constructSchema.shape.description.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid description";
  }
};

const validateTemplateId = (value: string) => {
  const result = constructSchema.shape.templateId.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Template is required";
  }
};

type ConstructFormProps = {
  construct?: Construct;
  mode?: "create" | "edit";
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function ConstructForm({
  construct,
  mode = "create",
  onSuccess,
  onCancel,
}: ConstructFormProps) {
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";
  const submitLabel = isEdit ? "Save Changes" : "Create Construct";
  const pendingLabel = isEdit ? "Saving..." : "Creating...";

  const {
    data: templates,
    isLoading: templatesLoading,
    error: templatesError,
  } = useQuery(templateQueries.all());

  const mutation = useMutation({
    mutationFn: (values: ConstructFormValues) => {
      if (isEdit) {
        if (!construct) {
          throw new Error("Construct data is required to update");
        }

        return constructMutations.update.mutationFn({
          id: construct.id,
          body: values as UpdateConstructInput,
        });
      }

      return constructMutations.create.mutationFn(values);
    },
    onSuccess: () => {
      toast.success(
        isEdit
          ? "Construct updated successfully"
          : "Construct created successfully"
      );
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
      if (!isEdit) {
        form.reset();
      }
      onSuccess?.();
    },
    onError: (error) => {
      const fallback = isEdit
        ? "Failed to update construct"
        : "Failed to create construct";
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message);
    },
  });

  const defaultValues = useMemo(
    () => ({
      name: construct?.name ?? "",
      description: construct?.description ?? "",
      templateId: construct?.templateId ?? "",
    }),
    [construct]
  );

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      mutation.mutate(value as ConstructFormValues);
    },
  });

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
        No templates available. Add templates in synthetic.config.ts to
        continue.
      </div>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          {isEdit ? "Edit Construct" : "Create New Construct"}
        </CardTitle>
      </CardHeader>
      <CardContent>
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
                  placeholder="Enter construct name"
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
                  placeholder="Enter construct description (optional)"
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
                <Select
                  data-testid="template-select"
                  disabled={mutation.isPending}
                  onValueChange={(value) => field.handleChange(value)}
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
                {field.state.meta.errors.length > 0 && (
                  <p className="text-red-600 text-sm">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

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
              {mutation.isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
