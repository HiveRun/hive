"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, CircleDot, Loader2, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { cellMutations, cellQueries } from "@/queries/cells";
import { workspaceQueries } from "@/queries/workspaces";

type WorkspaceTreeProps = {
  collapsed: boolean;
};

type PendingCellDelete = {
  id: string;
  name: string;
  workspaceId: string;
};

export function WorkspaceTree({ collapsed: _collapsed }: WorkspaceTreeProps) {
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set()
  );
  const confirmDeleteRef = useRef(false);
  const [pendingCellDelete, setPendingCellDelete] =
    useState<PendingCellDelete | null>(null);

  const activeWorkspaceId = location.search.workspaceId;

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
  };

  const deleteCell = useMutation({
    mutationFn: async ({ id }: { id: string; workspaceId: string }) =>
      cellMutations.delete.mutationFn(id),
    onSuccess: async (
      _result: unknown,
      variables: { id: string; workspaceId: string }
    ) => {
      const deletedCellId = variables.id;
      const workspaceId = variables.workspaceId;
      await queryClient.invalidateQueries({
        queryKey: cellQueries.all(workspaceId).queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: ["cells"] });

      if (location.pathname.startsWith(`/cells/${deletedCellId}`)) {
        navigate({
          to: "/cells/list",
          search: workspaceId ? { workspaceId } : undefined,
          replace: true,
        });
      }

      toast.success("Cell deleted");
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Failed to delete cell";
      toast.error(message);
    },
    onSettled: () => {
      confirmDeleteRef.current = false;
      setPendingCellDelete(null);
    },
  });

  return (
    <SidebarMenu>
      <AlertDialog
        onOpenChange={(open) => {
          if (!(open || deleteCell.isPending || confirmDeleteRef.current)) {
            setPendingCellDelete(null);
          }
        }}
        open={pendingCellDelete !== null}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cell?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the cell and its worktree.
              {pendingCellDelete ? (
                <span className="mt-2 block font-mono text-xs">
                  {pendingCellDelete.name}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCell.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!pendingCellDelete || deleteCell.isPending}
              onClick={() => {
                if (!pendingCellDelete) {
                  return;
                }
                confirmDeleteRef.current = true;
                deleteCell.mutate({
                  id: pendingCellDelete.id,
                  workspaceId: pendingCellDelete.workspaceId,
                });
              }}
            >
              {deleteCell.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WorkspaceTreeContent
        collapsed={_collapsed}
        expandedWorkspaceIds={expandedWorkspaceIds}
        location={location}
        onRequestDeleteCell={(cell: PendingCellDelete) =>
          setPendingCellDelete(cell)
        }
        onToggleWorkspace={toggleWorkspace}
      />
    </SidebarMenu>
  );
}

type WorkspaceTreeContentProps = {
  location: { pathname: string; search: Record<string, string> };
  collapsed: boolean;
  expandedWorkspaceIds: Set<string>;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceTreeContent({
  location,
  collapsed,
  expandedWorkspaceIds,
  onRequestDeleteCell,
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
          <Loader2 className="size-4 animate-spin" />
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
      onRequestDeleteCell={onRequestDeleteCell}
      onToggleWorkspace={onToggleWorkspace}
      workspace={workspace}
    />
  ));
}

type WorkspaceSectionProps = {
  workspace: { id: string; label: string; path: string };
  location: { pathname: string; search: Record<string, string> };
  expandedWorkspaceIds: Set<string>;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceSection({
  workspace,
  location,
  expandedWorkspaceIds,
  onRequestDeleteCell,
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
    onRequestDeleteCell,
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
                  "size-4 transition-transform",
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
            <Plus className="size-4" />
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
  onRequestDeleteCell,
  workspaceId,
}: {
  cells: Array<{ id: string; name: string }>;
  cellsLoading: boolean;
  isExpanded: boolean;
  location: { pathname: string; search: Record<string, string> };
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  workspaceId: string;
}): ReactNode {
  if (!isExpanded) {
    return null;
  }

  if (cellsLoading) {
    return (
      <SidebarMenuItem>
        <div className="ml-4 px-3 py-1.5 text-muted-foreground text-xs">
          <Loader2 className="mr-2 inline-block size-4 animate-spin" />
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
            "box-border w-full rounded-none border-2 border-transparent py-1.5 pr-10 pl-4 text-left text-muted-foreground text-xs tracking-normal transition-none",
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
            <CircleDot className="size-4 shrink-0" />
            <span className="truncate">{cell.name}</span>
          </Link>
        </SidebarMenuButton>

        <SidebarMenuAction
          aria-label={`Delete ${cell.name}`}
          className="rounded-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDeleteCell({
              id: cell.id,
              name: cell.name,
              workspaceId,
            });
          }}
          type="button"
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete</span>
        </SidebarMenuAction>
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
