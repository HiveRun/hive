import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";

type StorybookRouterProps = {
  children: ReactNode;
};

const StorybookContentContext = createContext<ReactNode>(null);

function StorybookContent() {
  const content = useContext(StorybookContentContext);
  return <>{content}</>;
}

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: StorybookContent,
});

const storybookRouter = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  history: createMemoryHistory({
    initialEntries: ["/"],
  }),
});

export function StorybookRouter({ children }: StorybookRouterProps) {
  return (
    <StorybookContentContext.Provider value={children}>
      <RouterProvider router={storybookRouter} />
    </StorybookContentContext.Provider>
  );
}
