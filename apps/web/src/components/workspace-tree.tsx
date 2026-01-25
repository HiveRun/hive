"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, CircleDot, Loader2, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CellCreationSheet } from "@/components/cell-creation-sheet";
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
import { storage } from "@/lib/storage";
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

const EXPANDED_WORKSPACES_STORAGE_KEY = "hive.sidebar.expanded-workspaces";

export function WorkspaceTree({ collapsed: _collapsed }: WorkspaceTreeProps) {
  const routerState = useRouterState({
    select: (state) => ({ location: state.location, matches: state.matches }),
  });
  const location = routerState.location;

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set()
  );
  const confirmDeleteRef = useRef(false);
  const [pendingCellDelete, setPendingCellDelete] =
    useState<PendingCellDelete | null>(null);

  const [pendingCellCreateWorkspaceId, setPendingCellCreateWorkspaceId] =
    useState<string | null>(null);

  const workspaceIdFromSearch = location.search.workspaceId;
  const cellRouteMatch = routerState.matches.find(
    (match) => match.routeId === "/cells/$cellId"
  );
  const workspaceIdFromLoaderData = (() => {
    const loaderData = cellRouteMatch?.loaderData;
    if (!loaderData || typeof loaderData !== "object") {
      return;
    }
    if (!("workspaceId" in loaderData)) {
      return;
    }
    const value = (loaderData as { workspaceId?: unknown }).workspaceId;
    return typeof value === "string" ? value : undefined;
  })();

  const activeWorkspaceId = workspaceIdFromSearch ?? workspaceIdFromLoaderData;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedIds = storage.get<string[]>(EXPANDED_WORKSPACES_STORAGE_KEY);
    if (!Array.isArray(savedIds)) {
      return;
    }
    setExpandedWorkspaceIds(
      () => new Set(savedIds.filter((entry) => typeof entry === "string"))
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    storage.set(
      EXPANDED_WORKSPACES_STORAGE_KEY,
      Array.from(expandedWorkspaceIds)
    );
  }, [expandedWorkspaceIds]);

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
          to: "/",
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
      {pendingCellCreateWorkspaceId ? (
        <CellCreationSheet
          onOpenChange={(open) => {
            if (!open) {
              setPendingCellCreateWorkspaceId(null);
            }
          }}
          open={pendingCellCreateWorkspaceId !== null}
          workspaceId={pendingCellCreateWorkspaceId}
        />
      ) : null}

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
        activeWorkspaceId={activeWorkspaceId}
        collapsed={_collapsed}
        expandedWorkspaceIds={expandedWorkspaceIds}
        location={location}
        onRequestCreateCell={(workspaceId) =>
          setPendingCellCreateWorkspaceId(workspaceId)
        }
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
  activeWorkspaceId?: string;
  collapsed: boolean;
  expandedWorkspaceIds: Set<string>;
  onRequestCreateCell: (workspaceId: string) => void;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceTreeContent({
  location,
  activeWorkspaceId,
  collapsed,
  expandedWorkspaceIds,
  onRequestCreateCell,
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
      activeWorkspaceId={activeWorkspaceId}
      expandedWorkspaceIds={expandedWorkspaceIds}
      key={workspace.id}
      location={location}
      onRequestCreateCell={onRequestCreateCell}
      onRequestDeleteCell={onRequestDeleteCell}
      onToggleWorkspace={onToggleWorkspace}
      workspace={workspace}
    />
  ));
}

type WorkspaceSectionProps = {
  workspace: { id: string; label: string; path: string };
  activeWorkspaceId?: string;
  location: { pathname: string; search: Record<string, string> };
  expandedWorkspaceIds: Set<string>;
  onRequestCreateCell: (workspaceId: string) => void;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceSection({
  workspace,
  activeWorkspaceId,
  location,
  expandedWorkspaceIds,
  onRequestCreateCell,
  onRequestDeleteCell,
  onToggleWorkspace,
}: WorkspaceSectionProps) {
  const isWorkspaceActive = activeWorkspaceId === workspace.id;
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
              "relative box-border flex-1 justify-start rounded-none border-2 border-border/40 bg-transparent px-3 py-2 text-left font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-[0.22em] transition-none",
              "hover:border-border/70 hover:bg-primary/5 hover:text-foreground",
              (isExpanded || isWorkspaceActive) && "text-foreground",
              isExpanded && "bg-primary/5",
              isWorkspaceActive &&
                "before:absolute before:top-0 before:left-0 before:h-full before:w-[3px] before:bg-primary before:content-['']"
            )}
            onClick={() => onToggleWorkspace(workspace.id)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  isExpanded ? "rotate-90" : "rotate-0"
                )}
              />
              <span className="truncate">{workspace.label}</span>
            </span>
          </SidebarMenuButton>
          <button
            aria-label={`Create new cell in ${workspace.label}`}
            className="flex size-7 shrink-0 items-center justify-center rounded border-2 border-border/40 bg-transparent text-muted-foreground opacity-80 transition-none hover:border-border/70 hover:bg-primary/5 hover:text-foreground hover:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRequestCreateCell(workspace.id);
            }}
            type="button"
          >
            <Plus className="size-4" />
          </button>
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
        <div className="ml-7 px-3 py-1.5 text-muted-foreground text-xs">
          <Loader2 className="mr-2 inline-block size-4 animate-spin" />
          Loading...
        </div>
      </SidebarMenuItem>
    );
  }

  if (cells.length === 0) {
    return (
      <SidebarMenuItem>
        <div className="ml-7 px-3 py-1.5 text-muted-foreground text-xs">
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
            "relative box-border w-full rounded-none border-2 border-transparent bg-transparent py-1.5 pr-10 pl-8 text-left text-muted-foreground text-xs tracking-normal transition-none",
            "hover:bg-primary/5 hover:text-foreground",
            isCellActive &&
              "bg-primary/10 text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
          )}
        >
          <Link
            aria-label={cell.name}
            className="flex min-w-0 items-center gap-2"
            search={{ workspaceId }}
            to={cellPath}
          >
            <CircleDot
              className={cn(
                "size-4 shrink-0",
                isCellActive ? "text-primary" : "text-muted-foreground/70"
              )}
            />
            <span className="truncate">{cell.name}</span>
          </Link>
        </SidebarMenuButton>

        <SidebarMenuAction
          aria-label={`Delete ${cell.name}`}
          className="rounded-sm text-destructive/70 opacity-70 transition-none hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
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
