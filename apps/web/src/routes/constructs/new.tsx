import { createFileRoute } from "@tanstack/react-router";
import { ConstructForm } from "@/components/construct-form";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/constructs/new")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(templateQueries.all()),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <ConstructForm onSuccess={() => window.history.back()} />
    </div>
  );
}
