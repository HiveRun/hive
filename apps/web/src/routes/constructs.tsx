import { createFileRoute } from "@tanstack/react-router";
import { ConstructList } from "@/components/construct-list";

export const Route = createFileRoute("/constructs")({
  component: RouteComponent,
});

function RouteComponent() {
  return <ConstructList />;
}
