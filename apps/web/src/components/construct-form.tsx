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
import type { CreateConstructInput } from "@/lib/rpc";
import { constructMutations } from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

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
  workspaceId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function ConstructForm({
  workspaceId,
  onSuccess,
  onCancel,
}: ConstructFormProps) {
  const queryClient = useQueryClient();

  const {
    data: templatesData,
    isLoading: templatesLoading,
    error: templatesError,
  } = useQuery(templateQueries.all(workspaceId));

  const templates = templatesData?.templates;
  const defaults = templatesData?.defaults;

  const mutation = useMutation({
    mutationFn: constructMutations.create.mutationFn,
    onSuccess: (construct) => {
      if (construct.status === "error") {
        toast.warning("Construct created with setup errors", {
          description:
            construct.lastSetupError ??
            "Open the construct to rerun the setup commands manually.",
        });
      } else {
        toast.success("Construct created successfully");
      }

      queryClient.invalidateQueries({ queryKey: ["constructs", workspaceId] });
      form.reset();
      onSuccess?.();
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to create construct";
      const [headline, ...rest] = message.split("\n");
      const description = rest.join("\n").trim();
      toast.error(headline || "Failed to create construct", {
        description: description || undefined,
      });
    },
  });

  const defaultValues = useMemo(
    () => ({
      name: "",
      description: "",
      templateId: defaults?.templateId ?? "",
    }),
    [defaults?.templateId]
  );

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      mutation.mutate({ ...(value as ConstructFormValues), workspaceId });
    },
  });

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
        No templates available. Add templates in synthetic.config.ts to
        continue.
      </div>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Create New Construct</CardTitle>
      </CardHeader>
      <CardContent>
        {mutation.isError && mutationErrorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive text-sm">
            <p className="font-semibold">Construct creation failed</p>
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
                <div data-testid="template-select">
                  <Select
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
                </div>
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
              {mutation.isPending ? "Creating..." : "Create Construct"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
