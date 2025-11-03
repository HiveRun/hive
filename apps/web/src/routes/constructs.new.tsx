import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { constructMutations } from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";
import type { TemplateSummary } from "@/types/template";

const constructSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  templateId: z.string().min(1, "Template is required"),
});

type ConstructFormValues = {
  name: string;
  description: string;
  templateId: string;
};

type ConstructFormErrors = {
  name?: string;
  description?: string;
  templateId?: string;
};

export const Route = createFileRoute("/constructs/new")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(templateQueries.all()),
  component: NewConstructPage,
});

function NewConstructPage() {
  const navigate = useNavigate();
  const { data: templates } = useSuspenseQuery(templateQueries.all());

  const [formValues, setFormValues] = useState<ConstructFormValues>({
    name: "",
    description: "",
    templateId: "",
  });
  const [formErrors, setFormErrors] = useState<ConstructFormErrors>({});

  const createMutation = useMutation({
    ...constructMutations.create,
    onSuccess: (data) => {
      if (data && typeof data === "object" && "constructId" in data) {
        toast.success("Construct created successfully");
        navigate({
          to: "/constructs/$constructId",
          params: { constructId: data.constructId as string },
        });
      } else {
        toast.success("Construct created successfully");
        navigate({ to: "/constructs" });
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleInputChange = <Key extends keyof ConstructFormValues>(
    key: Key,
    value: ConstructFormValues[Key]
  ) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validateForm = (values: ConstructFormValues) => {
    const result = constructSchema.safeParse({
      ...values,
      description: values.description.trim() ? values.description : undefined,
    });

    if (result.success) {
      setFormErrors({});
      return {
        name: result.data.name,
        description: result.data.description,
        templateId: result.data.templateId,
      };
    }

    const fieldErrors: ConstructFormErrors = {};
    for (const issue of result.error.issues) {
      const pathKey = issue.path[0];
      if (typeof pathKey === "string") {
        fieldErrors[pathKey as keyof ConstructFormErrors] = issue.message;
      }
    }
    setFormErrors(fieldErrors);
    return null;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const parsed = validateForm(formValues);
    if (!parsed) {
      return;
    }

    createMutation.mutate({
      name: parsed.name,
      description: parsed.description?.trim() ? parsed.description : undefined,
      templateId: parsed.templateId,
    });
  };

  const canSubmit =
    formValues.name.trim().length > 0 &&
    formValues.templateId.trim().length > 0;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-8">
        <h1 className="font-bold text-3xl">Create New Construct</h1>
        <p className="mt-2 text-muted-foreground">
          Set up a new development construct with an AI agent
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>
                Give your construct a name and description
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  onChange={(event) =>
                    handleInputChange("name", event.target.value)
                  }
                  placeholder="My Project"
                  value={formValues.name}
                />
                {formErrors.name && (
                  <p className="text-destructive text-sm">{formErrors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  onChange={(event) =>
                    handleInputChange("description", event.target.value)
                  }
                  placeholder="What are you building?"
                  rows={3}
                  value={formValues.description}
                />
                {formErrors.description && (
                  <p className="text-destructive text-sm">
                    {formErrors.description}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Template Selection</CardTitle>
              <CardDescription>
                Choose a template that matches your workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="template">Template</Label>
                <Select
                  onValueChange={(value) =>
                    handleInputChange("templateId", value)
                  }
                  value={formValues.templateId}
                >
                  <SelectTrigger id="template">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template: TemplateSummary) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div>
                          <div className="font-medium">{template.label}</div>
                          <div className="text-muted-foreground text-sm">
                            {template.summary}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.templateId && (
                  <p className="text-destructive text-sm">
                    {formErrors.templateId}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button
              onClick={() => navigate({ to: "/constructs" })}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !canSubmit}
              type="submit"
            >
              {createMutation.isPending ? "Creating..." : "Create Construct"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
