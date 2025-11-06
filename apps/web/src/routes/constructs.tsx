import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/constructs")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/constructs") {
      throw redirect({ to: "/constructs/list" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
