import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { rpc } from "@/lib/rpc";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const response = await rpc.api.templates.get();
      if (response.error) {
        throw new Error("Failed to fetch templates");
      }
      return response.data;
    },
  });

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive text-sm">
            Failed to load templates. Please try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="font-bold text-3xl tracking-tight">Templates</h1>
        <p className="text-muted-foreground">
          Browse available construct templates
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <>
            <TemplateSkeleton />
            <TemplateSkeleton />
            <TemplateSkeleton />
          </>
        )}
        {!isLoading &&
          data?.templates &&
          data.templates.length > 0 &&
          data.templates.map((template) => (
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
        {!isLoading && (!data?.templates || data.templates.length === 0) && (
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

function TemplateSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}
