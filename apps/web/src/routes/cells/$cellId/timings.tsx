import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/cells/$cellId/timings")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/cells/$cellId/timings"!</div>;
}
