"use client";

import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, CircleDot, Loader2 } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { cellQueries } from "@/queries/cells";
import { workspaceQueries } from "@/queries/workspaces";

type WorkspaceTreeProps = {
  collapsed: boolean;
};

export function WorkspaceTree({ collapsed: _collapsed }: WorkspaceTreeProps) {
  const pathname = useRouterState({
    select: (routerState) => routerState.location.pathname,
  });

  return (
    <SidebarMenu>
      <WorkspaceTreeContent collapsed={_collapsed} pathname={pathname} />
    </SidebarMenu>
  );
}

type WorkspaceTreeContentProps = {
  pathname: string;
  collapsed: boolean;
};

function WorkspaceTreeContent({
  pathname,
  collapsed,
}: WorkspaceTreeContentProps) {
  const workspacesQuery = useQuery(workspaceQueries.list());
  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const workspacesLoading =
    workspacesQuery.isPending || workspacesQuery.isRefetching;

  if (collapsed) {
    return null;
  }

  if (workspacesLoading) {
    return (
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
          <Loader2 className="size-3 animate-spin" />
          Loading workspaces...
        </div>
      </SidebarMenuItem>
    );
  }

  if (workspaces.length === 0) {
    return <EmptyState />;
  }

  return workspaces.map((workspace) => (
    <WorkspaceSection
      key={workspace.id}
      pathname={pathname}
      workspace={workspace}
    />
  ));
}

type WorkspaceSectionProps = {
  workspace: { id: string; label: string; path: string };
  pathname: string;
};

function WorkspaceSection({ workspace, pathname }: WorkspaceSectionProps) {
  const cellsQuery = useQuery(cellQueries.all(workspace.id));
  const cells = cellsQuery.data ?? [];
  const cellsLoading = cellsQuery.isPending || cellsQuery.isRefetching;
  const isWorkspaceActive = pathname.includes(workspace.id);

  return (
    <div className="flex flex-col gap-1">
      <SidebarMenuItem>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]",
            isWorkspaceActive && "text-foreground"
          )}
        >
          <ChevronRight className="size-3" />
          <span className="truncate">{workspace.label}</span>
        </div>
      </SidebarMenuItem>

      {cellsLoading && (
        <SidebarMenuItem>
          <div className="ml-4 px-3 py-1.5 text-muted-foreground text-xs">
            <Loader2 className="mr-2 inline-block size-3 animate-spin" />
            Loading...
          </div>
        </SidebarMenuItem>
      )}
      {!cellsLoading && cells.length === 0 && (
        <SidebarMenuItem>
          <div className="ml-4 px-3 py-1.5 text-muted-foreground text-xs">
            No cells
          </div>
        </SidebarMenuItem>
      )}
      {!cellsLoading &&
        cells.map((cell) => {
          const cellPath = `/cells/${cell.id}`;
          const isCellActive = pathname.startsWith(cellPath);
          return (
            <SidebarMenuItem key={cell.id}>
              <SidebarMenuButton
                asChild
                className={cn(
                  "ml-4 rounded-none border-2 border-transparent px-3 py-1.5 text-left text-muted-foreground text-xs tracking-normal transition-none",
                  "hover:border-primary hover:bg-primary/10 hover:text-foreground",
                  isCellActive && "border-primary bg-primary/15 text-foreground"
                )}
              >
                <Link
                  aria-label={cell.name}
                  className="flex items-center gap-2"
                  to={cellPath}
                >
                  <CircleDot className="size-3 shrink-0" />
                  <span className="truncate">{cell.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center px-3 py-4 text-muted-foreground text-xs">
      No workspaces registered
    </div>
  );
}
