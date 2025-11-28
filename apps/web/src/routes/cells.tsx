import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/cells")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/cells") {
      throw redirect({ to: "/cells/list" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
