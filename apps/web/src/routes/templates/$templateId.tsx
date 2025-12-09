import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Server, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ensureActiveWorkspace } from "@/lib/workspace";
import { modelQueries } from "@/queries/models";
import {
  type Template,
  type TemplateService,
  templateQueries,
} from "@/queries/templates";

export const Route = createFileRoute("/templates/$templateId")({
  loader: async ({ params, context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    const templatesList = await queryClient.ensureQueryData(
      templateQueries.all(workspace.id)
    );
    const template = templatesList.templates.find(
      (entry) => entry.id === params.templateId
    );
    if (!template) {
      throw new Error("Template not found");
    }

    return {
      workspaceId: workspace.id,
      template,
      agentDefaults: templatesList.agentDefaults,
    };
  },
  component: TemplateDetailPage,
});

function TemplateDetailPage() {
  const { template, workspaceId, agentDefaults } = Route.useLoaderData();
  const { data: modelCatalog } = useQuery(
    modelQueries.byWorkspace(workspaceId)
  );

  const includePatterns = template.configJson.includePatterns ?? [];
  const ignorePatterns = template.configJson.ignorePatterns ?? [];
  const includeDirectories = template.includeDirectories ?? [];
  const gitignorePatterns = template.gitignorePatterns ?? [];

  const templateAgent = template.configJson.agent ?? {};
  const workspaceAgentDefaults = agentDefaults ?? {};

  const effectiveProviderId =
    templateAgent.providerId ?? workspaceAgentDefaults.providerId;
  const effectiveModelId =
    templateAgent.modelId ??
    workspaceAgentDefaults.modelId ??
    (effectiveProviderId
      ? modelCatalog?.defaults?.[effectiveProviderId]
      : undefined);

  const providerLabel =
    modelCatalog?.providers.find(
      (provider) => provider.id === effectiveProviderId
    )?.name ?? effectiveProviderId;

  const modelLabel = modelCatalog?.models.find(
    (model) =>
      model.id === effectiveModelId &&
      (!effectiveProviderId || model.provider === effectiveProviderId)
  )?.name;

  const services = Object.entries(template.configJson.services ?? []);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <TemplateHero template={template} />

      <div className="grid gap-4 lg:grid-cols-3">
        <AgentDefaultsCard
          effectiveModelId={effectiveModelId}
          modelLabel={modelLabel}
          providerLabel={providerLabel}
          templateAgent={templateAgent}
          workspaceAgentDefaults={workspaceAgentDefaults}
        />
        <IncludeCard
          gitignorePatterns={gitignorePatterns}
          ignorePatterns={ignorePatterns}
          includeDirectories={includeDirectories}
          includePatterns={includePatterns}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ServicesCard services={services} />
        <ContextCard
          agentsContext={template.agentsContext}
          truncated={template.agentsContextTruncated}
        />
      </div>

      <RuntimeCard config={template.configJson} />
    </div>
  );
}

function TemplateHero({ template }: { template: Template }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
          <span>Template</span>
          <Separator className="h-4" orientation="vertical" />
          <span className="font-mono">{template.id}</span>
        </div>
        <div className="flex items-center gap-3">
          <h1
            className="font-bold text-3xl tracking-tight"
            data-testid="template-detail-title"
          >
            {template.label}
          </h1>
          <Badge variant="secondary">{template.type}</Badge>
        </div>
        {template.configJson.summary ? (
          <p className="max-w-3xl text-muted-foreground">
            {template.configJson.summary}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/templates">
          <Button size="sm" variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to templates
          </Button>
        </Link>
      </div>
    </div>
  );
}

function AgentDefaultsCard({
  templateAgent,
  workspaceAgentDefaults,
  providerLabel,
  modelLabel,
  effectiveModelId,
}: {
  templateAgent: Template["configJson"]["agent"];
  workspaceAgentDefaults: Template["configJson"]["agent"] | undefined;
  providerLabel?: string;
  modelLabel?: string;
  effectiveModelId?: string;
}) {
  const templateAgentLabel =
    templateAgent?.providerId || templateAgent?.modelId
      ? `${templateAgent?.providerId ?? ""} ${
          templateAgent?.modelId ?? ""
        }`.trim()
      : "Not set — uses workspace defaults";

  const workspaceDefaultLabel =
    workspaceAgentDefaults?.providerId || workspaceAgentDefaults?.modelId
      ? `${workspaceAgentDefaults?.providerId ?? ""} ${
          workspaceAgentDefaults?.modelId ?? ""
        }`.trim()
      : "Not configured";

  return (
    <Card className="lg:col-span-2" data-testid="template-agent-info">
      <CardHeader className="space-y-1">
        <CardTitle>Model & Agent Defaults</CardTitle>
        <p className="text-muted-foreground text-sm">
          Shows how this template will pick a model when launched.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <InfoBlock label="Template agent" value={templateAgentLabel} />
        <InfoBlock label="Workspace defaults" value={workspaceDefaultLabel} />
        <InfoBlock
          label="Resolved provider"
          value={providerLabel ?? "Not set"}
        />
        <InfoBlock
          label="Resolved model"
          value={modelLabel ?? effectiveModelId ?? "Not set"}
        />
      </CardContent>
    </Card>
  );
}

function IncludeCard({
  includePatterns,
  includeDirectories,
  ignorePatterns,
  gitignorePatterns,
}: {
  includePatterns: string[];
  includeDirectories: string[];
  ignorePatterns: string[];
  gitignorePatterns: string[];
}) {
  return (
    <Card data-testid="template-metadata">
      <CardHeader className="space-y-1">
        <CardTitle>Include & Ignore</CardTitle>
        <p className="text-muted-foreground text-sm">
          How gitignored files are pulled into worktrees for this template.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <MetadataList
          emptyLabel="No include patterns configured"
          items={includePatterns}
          title="Include patterns"
        />
        <MetadataList
          emptyLabel="No directories matched yet"
          items={includeDirectories}
          title="Resolved directories"
        />
        <MetadataList
          emptyLabel="No additional ignore patterns"
          items={ignorePatterns}
          title="Ignore patterns"
        />
        <MetadataList
          emptyLabel=".gitignore not found"
          items={gitignorePatterns}
          title="Workspace .gitignore"
        />
      </CardContent>
    </Card>
  );
}

type ServiceEntry = [string, TemplateService];

function ServicesCard({ services }: { services: ServiceEntry[] }) {
  return (
    <Card className="lg:col-span-2" data-testid="template-services">
      <CardHeader className="space-y-1">
        <CardTitle>Services</CardTitle>
        <p className="text-muted-foreground text-sm">
          Commands and images defined by the template.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {services.length === 0 ? (
          <p className="text-muted-foreground text-sm">No services defined.</p>
        ) : (
          services.map(([serviceName, service]) => (
            <ServiceItem
              key={serviceName}
              name={serviceName}
              service={service}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ServiceItem({
  name,
  service,
}: {
  name: string;
  service: TemplateService;
}) {
  return (
    <div className="rounded border border-border bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="flex items-center gap-1" variant="outline">
          <Server className="h-3.5 w-3.5" /> {service.type}
        </Badge>
        <span className="font-medium">{name}</span>
        {service.cwd ? (
          <span className="text-muted-foreground text-xs">{service.cwd}</span>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {service.run ? <InfoBlock label="Run" value={service.run} /> : null}
        {service.command ? (
          <InfoBlock label="Command" value={service.command} />
        ) : null}
        {service.image ? (
          <InfoBlock label="Image" value={service.image} />
        ) : null}
        {service.file ? (
          <InfoBlock label="Compose file" value={service.file} />
        ) : null}
        {service.services?.length ? (
          <InfoBlock
            label="Compose services"
            value={service.services.join(", ")}
          />
        ) : null}
        {service.ports?.length ? (
          <InfoBlock label="Ports" value={service.ports.join(", ")} />
        ) : null}
        {service.volumes?.length ? (
          <InfoBlock label="Volumes" value={service.volumes.join(", ")} />
        ) : null}
        {service.env && Object.keys(service.env).length > 0 ? (
          <InfoBlock
            label="Env"
            value={Object.entries(service.env)
              .map(([key, value]) => `${key}=${value}`)
              .join(" | ")}
          />
        ) : null}
        {service.setup?.length ? (
          <InfoBlock label="Setup" value={service.setup.join(" · ")} />
        ) : null}
        {service.stop ? <InfoBlock label="Stop" value={service.stop} /> : null}
      </div>
    </div>
  );
}

function ContextCard({
  agentsContext,
  truncated,
}: {
  agentsContext?: string;
  truncated?: boolean;
}) {
  return (
    <Card data-testid="template-context">
      <CardHeader className="space-y-1">
        <CardTitle>AGENTS Context</CardTitle>
        <p className="text-muted-foreground text-sm">
          Preview of the generated AGENTS.md for this workspace.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {agentsContext ? (
          <div className="space-y-2">
            <div className="max-h-80 overflow-auto rounded border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
              {agentsContext}
            </div>
            {truncated ? (
              <p className="text-muted-foreground text-xs">
                Truncated preview. Open AGENTS.md for full context.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            AGENTS.md was not found in this workspace.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RuntimeCard({ config }: { config: Template["configJson"] }) {
  return (
    <Card data-testid="template-runtime">
      <CardHeader className="space-y-1">
        <CardTitle>Runtime Setup</CardTitle>
        <p className="text-muted-foreground text-sm">
          Commands, prompts, and teardown steps defined on the template.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetadataList
          emptyLabel="No setup commands"
          items={config.setup ?? []}
          title="Setup"
        />
        <MetadataList
          emptyLabel="No prompt fragments"
          items={config.prompts ?? []}
          title="Prompts"
        />
        <MetadataList
          emptyLabel="No template env"
          items={Object.entries(config.env ?? {}).map(
            ([key, value]) => `${key}=${value}`
          )}
          title="Env"
        />
        <MetadataList
          emptyLabel="No teardown commands"
          items={config.teardown ?? []}
          title="Teardown"
        />
      </CardContent>
    </Card>
  );
}

function MetadataList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  if (!items || items.length === 0) {
    return (
      <div className="space-y-1">
        <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </p>
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            className="rounded border border-border/60 bg-muted/40 px-2 py-1 text-sm"
            key={`${title}-${item}`}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoBlock({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="space-y-1 rounded border border-border/70 bg-muted/30 p-2">
      <p className="flex items-center gap-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
        <Shield className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="text-foreground text-sm">{value || "—"}</p>
    </div>
  );
}
