import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/opencode-test/$sessionId")({
  component: SessionLayout,
});

function SessionLayout() {
  return <Outlet />;
}
