import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rpc } from "@/lib/rpc";

type TemplateResponse = {
  id: string;
  label: string;
  type: string;
  configJson: unknown;
};

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { data } = useSuspenseQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data: responseData, error } = await rpc.api.templates.get();

      if (error) {
        throw new Error("Failed to fetch templates");
      }

      return responseData;
    },
  });

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="font-bold text-3xl tracking-tight">Templates</h1>
        <p className="text-muted-foreground">
          Browse available construct templates
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.templates &&
          data.templates.length > 0 &&
          data.templates.map((template: TemplateResponse) => (
            <Card
              className="transition-colors hover:border-primary/50"
              key={template.id}
            >
              <CardHeader>
                <CardTitle className="text-lg">{template.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-xs">
                  ID: {template.id}
                </div>
              </CardContent>
            </Card>
          ))}
        {(!data?.templates || data.templates.length === 0) && (
          <div className="col-span-full py-12 text-center">
            <p className="text-muted-foreground">No templates available</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Create a{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                synthetic.config.ts
              </code>{" "}
              file to define templates
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
