import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureActiveWorkspace } from "@/lib/workspace";
import { type Template, templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/templates")({
  loader: async ({ context: { queryClient } }) => {
    const workspace = await ensureActiveWorkspace(queryClient);
    await queryClient.ensureQueryData(templateQueries.all(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: TemplatesPage,
});

function TemplatesPage() {
  const { workspaceId } = Route.useLoaderData();
  const { data } = useSuspenseQuery(templateQueries.all(workspaceId));
  const templates = data.templates ?? [];

  const getServiceIcon = (type: string) => {
    switch (type) {
      case "process":
        return "⚡";
      case "docker":
        return "🐳";
      case "compose":
        return "🔧";
      default:
        return "📦";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "manual":
        return "bg-blue-500";
      case "implementation":
        return "bg-green-500";
      case "planning":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1
          className="font-bold text-3xl tracking-tight"
          data-testid="templates-page-title"
        >
          Templates
        </h1>
        <p className="text-muted-foreground">
          Browse available construct templates
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {templates.length > 0 &&
          templates.map((template: Template) => (
            <Card
              className="transition-colors hover:border-primary/50"
              data-testid="template-card"
              key={template.id}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{template.label}</CardTitle>
                  <Badge
                    className={`text-white ${getTypeColor(template.type)}`}
                    variant="secondary"
                  >
                    {template.type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div
                    className="text-muted-foreground text-xs"
                    data-testid="template-id"
                  >
                    ID: {template.id}
                  </div>

                  {template.configJson.services && (
                    <div>
                      <h4 className="mb-2 font-medium text-sm">Services</h4>
                      <div className="space-y-2">
                        {Object.entries(template.configJson.services).map(
                          ([serviceName, service]) => (
                            <div
                              className="flex items-center gap-2 rounded border p-2"
                              key={serviceName}
                            >
                              <span className="text-lg">
                                {getServiceIcon(service.type)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm">
                                  {serviceName}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                  {service.type}
                                  {service.run && ` • ${service.run}`}
                                  {service.image && ` • ${service.image}`}
                                  {service.file && ` • ${service.file}`}
                                </div>
                              </div>
                              <Badge className="text-xs" variant="outline">
                                {service.type}
                              </Badge>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {template.configJson.env && (
                    <div>
                      <h4 className="mb-2 font-medium text-sm">
                        Environment Variables
                      </h4>
                      <div className="space-y-1">
                        {Object.entries(template.configJson.env).map(
                          ([key, value]) => (
                            <div
                              className="text-muted-foreground text-xs"
                              key={key}
                            >
                              <code className="rounded bg-muted px-1 py-0.5">
                                {key}
                              </code>{" "}
                              ={" "}
                              <code className="rounded bg-muted px-1 py-0.5">
                                {value}
                              </code>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {template.configJson.prompts && (
                    <div>
                      <h4 className="mb-2 font-medium text-sm">Prompts</h4>
                      <div className="space-y-1">
                        {template.configJson.prompts.map((prompt) => (
                          <div
                            className="text-muted-foreground text-xs"
                            key={prompt}
                          >
                            📄 {prompt}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {template.configJson.teardown && (
                    <div>
                      <h4 className="mb-2 font-medium text-sm">Teardown</h4>
                      <div className="space-y-1">
                        {template.configJson.teardown.map((cmd) => (
                          <div
                            className="text-muted-foreground text-xs"
                            key={cmd}
                          >
                            🧹 {cmd}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        {templates.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <p className="text-muted-foreground">No templates available</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Create a{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                hive.config.ts
              </code>{" "}
              file to define templates
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
