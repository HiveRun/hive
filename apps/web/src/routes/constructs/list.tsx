import { createFileRoute } from "@tanstack/react-router";
import { ConstructList } from "@/components/construct-list";
import { constructQueries } from "@/queries/constructs";

export const Route = createFileRoute("/constructs/list")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(constructQueries.all()),
  component: RouteComponent,
});

function RouteComponent() {
  return <ConstructList />;
}
