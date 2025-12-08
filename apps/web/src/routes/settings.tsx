import Form from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { HiveArrayTemplate } from "@/components/settings/hive-array-template";
import { HiveFieldTemplate } from "@/components/settings/hive-field-template";
import { HiveObjectTemplate } from "@/components/settings/hive-object-template";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureActiveWorkspace } from "@/lib/workspace";
import {
  type HiveConfig,
  hiveSettingsMutations,
  hiveSettingsQueries,
} from "@/queries/settings";

type HiveSettingsFormEvent = {
  formData?: HiveConfig;
};

const SETTINGS_FORM_UI_SCHEMA: UiSchema = {
  "ui:order": ["opencode", "promptSources", "templates", "defaults"],
  opencode: {
    "ui:title": "Opencode Provider",
    "ui:order": ["defaultProvider", "defaultModel", "token"],
    token: {
      "ui:widget": "password",
      "ui:options": { inputType: "password", placeholder: "API token" },
    },
    defaultProvider: { "ui:title": "Default Provider" },
    defaultModel: { "ui:title": "Default Model" },
  },
  promptSources: {
    "ui:title": "Prompt Sources",
    "ui:options": {
      orderable: false,
      addButtonText: "Add prompt glob",
    },
    items: {
      "ui:placeholder": "docs/prompts/**/*.md",
    },
  },
  templates: {
    "ui:title": "Templates",
    "ui:description":
      "Each template configures services, env, prompts, and defaults.",
    "ui:options": {
      addButtonText: "Add template",
      orderable: false,
      removable: true,
      expandable: true,
    },
    additionalProperties: {
      "ui:order": [
        "id",
        "label",
        "type",
        "services",
        "env",
        "setup",
        "prompts",
        "agent",
        "teardown",
        "includePatterns",
        "ignorePatterns",
      ],
      services: {
        "ui:title": "Services",
        "ui:options": {
          addButtonText: "Add service",
          orderable: false,
          removable: true,
          expandable: true,
        },
        additionalProperties: {
          "ui:order": [
            "type",
            "run",
            "setup",
            "cwd",
            "env",
            "readyTimeoutMs",
            "stop",
            "image",
            "command",
            "ports",
            "volumes",
            "file",
            "services",
          ],
        },
      },
      env: {
        "ui:title": "Environment",
        "ui:options": { addButtonText: "Add env var" },
      },
      setup: {
        "ui:title": "Setup commands",
        "ui:options": { addButtonText: "Add setup step", orderable: true },
      },
      prompts: {
        "ui:title": "Prompts",
        "ui:options": { addButtonText: "Add prompt", orderable: false },
      },
      agent: {
        "ui:title": "Agent",
        "ui:order": ["providerId", "modelId", "agentId"],
      },
      teardown: {
        "ui:title": "Teardown commands",
        "ui:options": { addButtonText: "Add teardown step", orderable: true },
      },
      includePatterns: {
        "ui:title": "Include patterns",
        "ui:options": { addButtonText: "Add include", orderable: false },
      },
      ignorePatterns: {
        "ui:title": "Ignore patterns",
        "ui:options": { addButtonText: "Add ignore", orderable: false },
      },
    },
  },
  defaults: {
    "ui:title": "Default Behaviors",
    templateId: {
      "ui:title": "Default template",
    },
  },
};

export const Route = createFileRoute("/settings")({
  loader: async ({ context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    await queryClient.ensureQueryData(hiveSettingsQueries.detail(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { workspaceId } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(hiveSettingsQueries.detail(workspaceId));

  const formSchema = useMemo<RJSFSchema>(
    () => JSON.parse(JSON.stringify(data.schema)) as RJSFSchema,
    [data.schema]
  );

  const [formData, setFormData] = useState<HiveConfig>(data.config);
  const [isDirty, setIsDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setFormData(data.config);
    setIsDirty(false);
    setFormError(null);
  }, [data.config]);

  const templateCount = useMemo(
    () => Object.keys(formData.templates ?? {}).length,
    [formData.templates]
  );
  const promptSourceCount = useMemo(
    () => formData.promptSources.length,
    [formData.promptSources]
  );

  const mutation = useMutation({
    mutationFn: (config: HiveConfig) =>
      hiveSettingsMutations.update.mutationFn({ workspaceId, config }),
    onSuccess: (response) => {
      queryClient.setQueryData(
        hiveSettingsQueries.detail(workspaceId).queryKey,
        response
      );
      setFormData(response.config);
      setIsDirty(false);
      setFormError(null);
      toast.success("Hive settings saved", {
        description: "hive.config.ts updated and validated",
      });
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to save settings";
      setFormError(message);
      toast.error(message);
    },
  });

  const handleFormChange = (event: HiveSettingsFormEvent) => {
    setFormData(event.formData ?? data.config);
    setIsDirty(true);
    setFormError(null);
  };

  const handleFormSubmit = (event: HiveSettingsFormEvent) => {
    const nextConfig = event.formData ?? data.config;
    setFormError(null);
    mutation.mutate(nextConfig);
  };

  const handleReset = () => {
    setFormData(data.config);
    setIsDirty(false);
    setFormError(null);
  };

  const infoBadges = useMemo(
    () => [
      `${templateCount} template${templateCount === 1 ? "" : "s"}`,
      `${promptSourceCount} prompt source${promptSourceCount === 1 ? "" : "s"}`,
      formData.defaults?.templateId
        ? `Default: ${formData.defaults.templateId}`
        : "No default template",
    ],
    [formData.defaults?.templateId, promptSourceCount, templateCount]
  );

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="font-semibold text-3xl uppercase tracking-[0.24em]">
          Hive Settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Use the schema-driven form to edit your workspace configuration before
          persisting it to
          <code className="ml-2 rounded bg-muted px-1 py-0.5 text-xs">
            hive.config.ts
          </code>
          .
        </p>
      </div>

      <Card className="border-3 border-border shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg uppercase tracking-[0.2em]">
              Active Workspace
            </CardTitle>
            <p className="text-muted-foreground text-sm">{data.workspaceId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {infoBadges.map((text) => (
              <Badge key={text} variant="outline">
                {text}
              </Badge>
            ))}
            {isDirty ? (
              <Badge variant="secondary">Unsaved changes</Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-4">
            {formError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
                <p className="font-semibold">Unable to save settings</p>
                <p className="mt-1 whitespace-pre-wrap">{formError}</p>
              </div>
            )}

            <Form<HiveConfig>
              className="hive-rjsf space-y-6"
              disabled={mutation.isPending}
              formData={formData}
              key={data.workspaceId}
              liveValidate
              noHtml5Validate
              onChange={handleFormChange}
              onSubmit={handleFormSubmit}
              schema={formSchema}
              templates={{
                FieldTemplate: HiveFieldTemplate,
                ArrayFieldTemplate: HiveArrayTemplate,
                ObjectFieldTemplate: HiveObjectTemplate,
              }}
              uiSchema={SETTINGS_FORM_UI_SCHEMA}
              validator={validator}
            >
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  disabled={!isDirty || mutation.isPending}
                  onClick={handleReset}
                  type="button"
                  variant="outline"
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Reset
                </Button>
                <Button disabled={mutation.isPending} type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  {mutation.isPending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </Form>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm">
              <p className="font-semibold text-muted-foreground uppercase tracking-[0.18em]">
                Paths
              </p>
              <p className="mt-2 break-all text-foreground">
                Config path: {data.configPath}
              </p>
              <p className="mt-2 break-all text-muted-foreground">
                Workspace root: {data.workspacePath}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm">
              <p className="font-semibold text-muted-foreground uppercase tracking-[0.18em]">
                Save checks
              </p>
              <ul className="mt-2 space-y-1 text-foreground">
                <li>• Schema-driven form with live validation</li>
                <li>• Server re-validates before writing the file</li>
                <li>• Cache clears so new settings load everywhere</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
