import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/constructs")({
  component: ConstructsLayout,
});

function ConstructsLayout() {
  return <Outlet />;
}
