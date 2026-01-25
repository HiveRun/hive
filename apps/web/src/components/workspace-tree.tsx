"use client";

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, CircleDot, Loader2, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });

  const navigate = useNavigate();
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set()
  );

  const activeWorkspaceId = location.search.workspaceId;
  const expandedSet = useMemo(() => {
    const next = new Set(expandedWorkspaceIds);
    if (activeWorkspaceId) {
      next.add(activeWorkspaceId);
    }
    return next;
  }, [activeWorkspaceId, expandedWorkspaceIds]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setExpandedWorkspaceIds((prev) => {
      if (prev.has(activeWorkspaceId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeWorkspaceId);
      return next;
    });
  }, [activeWorkspaceId]);

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });

    navigate({
      to: location.pathname,
      replace: true,
      search: (prev) => ({
        ...(prev ?? {}),
        workspaceId,
      }),
    });
  };

  return (
    <SidebarMenu>
      <WorkspaceTreeContent
        collapsed={_collapsed}
        expandedWorkspaceIds={expandedSet}
        location={location}
        onToggleWorkspace={toggleWorkspace}
      />
    </SidebarMenu>
  );
}

type WorkspaceTreeContentProps = {
  location: { pathname: string; search: Record<string, string> };
  collapsed: boolean;
  expandedWorkspaceIds: Set<string>;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceTreeContent({
  location,
  collapsed,
  expandedWorkspaceIds,
  onToggleWorkspace,
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
      expandedWorkspaceIds={expandedWorkspaceIds}
      key={workspace.id}
      location={location}
      onToggleWorkspace={onToggleWorkspace}
      workspace={workspace}
    />
  ));
}

type WorkspaceSectionProps = {
  workspace: { id: string; label: string; path: string };
  location: { pathname: string; search: Record<string, string> };
  expandedWorkspaceIds: Set<string>;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceSection({
  workspace,
  location,
  expandedWorkspaceIds,
  onToggleWorkspace,
}: WorkspaceSectionProps) {
  const isWorkspaceActive = location.search.workspaceId === workspace.id;
  const isExpanded = expandedWorkspaceIds.has(workspace.id);

  const cellsQuery = useQuery({
    ...cellQueries.all(workspace.id),
    enabled: isExpanded,
  });
  const cells = cellsQuery.data ?? [];
  const cellsLoading = cellsQuery.isPending || cellsQuery.isRefetching;

  const cellsContent = renderWorkspaceCells({
    cells,
    cellsLoading,
    isExpanded,
    location,
    workspaceId: workspace.id,
  });

  return (
    <div className="flex flex-col gap-1">
      <SidebarMenuItem>
        <div className="flex items-center gap-1">
          <SidebarMenuButton
            className={cn(
              "box-border flex-1 justify-start rounded-none border-2 border-transparent px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em] transition-none",
              "hover:border-primary hover:bg-primary/10 hover:text-foreground",
              isWorkspaceActive &&
                "border-primary bg-primary/15 text-foreground"
            )}
            onClick={() => onToggleWorkspace(workspace.id)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  isExpanded ? "rotate-90" : "rotate-0"
                )}
              />
              <span className="truncate">{workspace.label}</span>
            </span>
          </SidebarMenuButton>
          <Link
            aria-label={`Create new cell in ${workspace.label}`}
            className="flex size-7 shrink-0 items-center justify-center rounded border-2 border-border transition-none hover:border-primary hover:bg-primary/10"
            search={{ workspaceId: workspace.id }}
            to="/cells/new"
          >
            <Plus className="size-3" />
          </Link>
        </div>
      </SidebarMenuItem>

      {cellsContent}
    </div>
  );
}

function renderWorkspaceCells({
  cells,
  cellsLoading,
  isExpanded,
  location,
  workspaceId,
}: {
  cells: Array<{ id: string; name: string }>;
  cellsLoading: boolean;
  isExpanded: boolean;
  location: { pathname: string; search: Record<string, string> };
  workspaceId: string;
}): ReactNode {
  if (!isExpanded) {
    return null;
  }

  if (cellsLoading) {
    return (
      <SidebarMenuItem>
        <div className="ml-4 px-3 py-1.5 text-muted-foreground text-xs">
          <Loader2 className="mr-2 inline-block size-3 animate-spin" />
          Loading...
        </div>
      </SidebarMenuItem>
    );
  }

  if (cells.length === 0) {
    return (
      <SidebarMenuItem>
        <div className="ml-4 px-3 py-1.5 text-muted-foreground text-xs">
          No cells
        </div>
      </SidebarMenuItem>
    );
  }

  return cells.map((cell) => {
    const cellPath = `/cells/${cell.id}`;
    const isCellActive = location.pathname.startsWith(cellPath);
    return (
      <SidebarMenuItem key={cell.id}>
        <SidebarMenuButton
          asChild
          className={cn(
            "box-border w-full rounded-none border-2 border-transparent py-1.5 pr-4 pl-4 text-left text-muted-foreground text-xs tracking-normal transition-none",
            "hover:border-primary hover:bg-primary/10 hover:text-foreground",
            isCellActive && "border-primary bg-primary/15 text-foreground"
          )}
        >
          <Link
            aria-label={cell.name}
            className="flex items-center gap-2"
            search={{ workspaceId }}
            to={cellPath}
          >
            <CircleDot className="size-3 shrink-0" />
            <span className="truncate">{cell.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center px-3 py-4 text-muted-foreground text-xs">
      No workspaces registered
    </div>
  );
}
