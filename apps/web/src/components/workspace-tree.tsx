"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  CircleX,
  Clock3,
  Loader2,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { useCellStatusStream } from "@/hooks/use-cell-status-stream";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { agentQueries } from "@/queries/agents";
import type { Cell, CellStatus } from "@/queries/cells";
import { cellMutations, cellQueries } from "@/queries/cells";
import { templateQueries } from "@/queries/templates";
import { workspaceQueries } from "@/queries/workspaces";

const PROVISIONING_STATUSES: CellStatus[] = ["spawning", "pending"];

type WorkspaceTreeProps = {
  collapsed: boolean;
};

type PendingCellDelete = {
  id: string;
  name: string;
  workspaceId: string;
};

const EXPANDED_WORKSPACES_STORAGE_KEY = "hive.sidebar.expanded-workspaces";

const AGENT_STATUS_POLL_WORKING_MS = 2000;
const AGENT_STATUS_POLL_AWAITING_INPUT_MS = 30_000;
const AGENT_STATUS_POLL_IDLE_MS = 120_000;
const TEMPLATE_PREFETCH_STALE_MS = 60_000;

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
  const [pendingCellDelete, setPendingCellDelete] =
    useState<PendingCellDelete | null>(null);
  const [deletingCellIds, setDeletingCellIds] = useState<Set<string>>(
    () => new Set()
  );

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
    onMutate: (variables: { id: string; workspaceId: string }) => {
      setDeletingCellIds((prev) => {
        const next = new Set(prev);
        next.add(variables.id);
        return next;
      });
    },
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
    onSettled: (
      _result: unknown,
      _error: unknown,
      variables: { id: string; workspaceId: string }
    ) => {
      setDeletingCellIds((prev) => {
        if (!prev.has(variables.id)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
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
          if (!open) {
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!pendingCellDelete}
              onClick={() => {
                if (!pendingCellDelete) {
                  return;
                }

                const cellToDelete = pendingCellDelete;
                setPendingCellDelete(null);
                toast.info(`Deleting ${cellToDelete.name}...`);

                deleteCell.mutate({
                  id: cellToDelete.id,
                  workspaceId: cellToDelete.workspaceId,
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          className={cn(
            "relative box-border w-full rounded-none border-2 border-transparent bg-transparent py-1.5 pr-4 pl-3 text-left text-muted-foreground text-xs tracking-normal transition-none",
            "hover:bg-primary/5 hover:text-foreground",
            location.pathname.startsWith("/timings") &&
              "bg-primary/10 text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
          )}
        >
          <Link aria-label="Global timings" to="/timings">
            <Clock3 className="size-4" />
            <span>Global Timings</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <WorkspaceTreeContent
        activeWorkspaceId={activeWorkspaceId}
        collapsed={_collapsed}
        deletingCellIds={deletingCellIds}
        expandedWorkspaceIds={expandedWorkspaceIds}
        location={location}
        onRequestCreateCell={(workspaceId) => {
          queryClient
            .prefetchQuery({
              ...templateQueries.all(workspaceId),
              staleTime: TEMPLATE_PREFETCH_STALE_MS,
            })
            .catch(() => {
              // no-op prefetch failure; CellForm handles fetch errors
            });

          setPendingCellCreateWorkspaceId(workspaceId);
        }}
        onRequestDeleteCell={(cell: PendingCellDelete) =>
          setPendingCellDelete(cell)
        }
        onToggleWorkspace={toggleWorkspace}
      />
    </SidebarMenu>
  );
}

type WorkspaceTreeContentProps = {
  location: { pathname: string };
  activeWorkspaceId?: string;
  collapsed: boolean;
  deletingCellIds: Set<string>;
  expandedWorkspaceIds: Set<string>;
  onRequestCreateCell: (workspaceId: string) => void;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceTreeContent({
  location,
  activeWorkspaceId,
  collapsed,
  deletingCellIds,
  expandedWorkspaceIds,
  onRequestCreateCell,
  onRequestDeleteCell,
  onToggleWorkspace,
}: WorkspaceTreeContentProps) {
  const workspacesQuery = useQuery(workspaceQueries.list());
  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const workspacesLoading =
    workspacesQuery.isPending && workspacesQuery.data === undefined;

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
      deletingCellIds={deletingCellIds}
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
  deletingCellIds: Set<string>;
  location: { pathname: string };
  expandedWorkspaceIds: Set<string>;
  onRequestCreateCell: (workspaceId: string) => void;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
  onToggleWorkspace: (workspaceId: string) => void;
};

function WorkspaceSection({
  workspace,
  activeWorkspaceId,
  deletingCellIds,
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
  const cellsLoading = cellsQuery.isPending && cellsQuery.data === undefined;

  const hasProvisioningCells = cells.some((cell) =>
    PROVISIONING_STATUSES.includes(cell.status)
  );

  useCellStatusStream(workspace.id, {
    enabled: isExpanded && hasProvisioningCells,
  });

  const readyCells = isExpanded
    ? cells.filter((cell) => cell.status === "ready")
    : [];

  const agentSessionQueries = useQueries({
    queries: readyCells.map((cell) => {
      const query = agentQueries.sessionByCell(cell.id);
      return {
        queryKey: query.queryKey,
        queryFn: query.queryFn,
        staleTime: 2000,
        refetchInterval: (queryInstance: {
          state: { data: { status?: string } | null | undefined };
        }) => {
          const status = queryInstance.state.data?.status;
          if (status === "working") {
            return AGENT_STATUS_POLL_WORKING_MS;
          }
          if (status === "awaiting_input") {
            return AGENT_STATUS_POLL_AWAITING_INPUT_MS;
          }
          return AGENT_STATUS_POLL_IDLE_MS;
        },
      };
    }),
  });

  const agentStatusByCellId = new Map<string, string | undefined>();
  readyCells.forEach((cell, index) => {
    agentStatusByCellId.set(cell.id, agentSessionQueries[index]?.data?.status);
  });

  const cellsContent = renderWorkspaceCells({
    cells,
    cellsLoading,
    deletingCellIds,
    isExpanded,
    location,
    agentStatusByCellId,
    onRequestDeleteCell,
    workspaceId: workspace.id,
  });

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="workspace-section"
      data-workspace-id={workspace.id}
    >
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
            data-testid="workspace-create-cell"
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
  deletingCellIds,
  isExpanded,
  location,
  agentStatusByCellId,
  onRequestDeleteCell,
  workspaceId,
}: {
  cells: Pick<Cell, "id" | "name" | "status">[];
  cellsLoading: boolean;
  deletingCellIds: Set<string>;
  isExpanded: boolean;
  location: { pathname: string };
  agentStatusByCellId: Map<string, string | undefined>;
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

  return cells.map((cell) =>
    renderWorkspaceCellItem({
      cell,
      deletingCellIds,
      location,
      agentStatusByCellId,
      workspaceId,
      onRequestDeleteCell,
    })
  );
}

function renderWorkspaceCellItem({
  cell,
  deletingCellIds,
  location,
  agentStatusByCellId,
  workspaceId,
  onRequestDeleteCell,
}: {
  cell: Pick<Cell, "id" | "name" | "status">;
  deletingCellIds: Set<string>;
  location: { pathname: string };
  agentStatusByCellId: Map<string, string | undefined>;
  workspaceId: string;
  onRequestDeleteCell: (cell: PendingCellDelete) => void;
}) {
  const cellPath = `/cells/${cell.id}`;
  const isCellActive = location.pathname.startsWith(cellPath);
  const isDeleting = deletingCellIds.has(cell.id);

  const agentStatus =
    cell.status === "ready" ? agentStatusByCellId.get(cell.id) : undefined;
  const statusIcon = getSidebarCellStatusIcon({
    isDeleting,
    isCellActive,
    cellStatus: cell.status,
    agentStatus,
  });
  const agentDotClass = agentStatus
    ? getAgentStatusDotClass(agentStatus)
    : "bg-border/60";

  return (
    <SidebarMenuItem key={cell.id}>
      <SidebarMenuButton
        asChild
        className={cn(
          "relative box-border w-full rounded-none border-2 border-transparent bg-transparent py-1.5 pr-16 pl-8 text-left text-muted-foreground text-xs tracking-normal transition-none",
          "hover:bg-primary/5 hover:text-foreground",
          isDeleting &&
            "border-destructive/40 bg-destructive/5 text-foreground",
          isCellActive &&
            "bg-primary/10 text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
        )}
      >
        <Link
          aria-label={cell.name}
          className="flex min-w-0 items-center gap-2"
          data-testid="workspace-cell-link"
          search={{ workspaceId }}
          to={cellPath}
        >
          {statusIcon}
          <span className="truncate">{cell.name}</span>
          {isDeleting ? (
            <span className="ml-1 text-[10px] text-destructive uppercase tracking-[0.22em]">
              deleting
            </span>
          ) : null}
          {cell.status === "ready" && !isDeleting ? (
            <span
              className={cn(
                "ml-1 inline-flex h-2 w-2 shrink-0 rounded-full",
                agentDotClass
              )}
              title={
                agentStatus ? `Agent ${agentStatus}` : "Agent status unknown"
              }
            />
          ) : null}
        </Link>
      </SidebarMenuButton>

      <SidebarMenuAction
        aria-label={`Delete ${cell.name}`}
        className="rounded-sm text-destructive/70 opacity-70 transition-none hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isDeleting) {
            return;
          }
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
}

function getSidebarCellStatusIcon({
  isDeleting,
  isCellActive,
  cellStatus,
  agentStatus,
}: {
  isDeleting: boolean;
  isCellActive: boolean;
  cellStatus: CellStatus;
  agentStatus?: string;
}) {
  if (isDeleting) {
    return (
      <Loader2
        className={cn(
          "size-4 shrink-0 animate-spin text-destructive/80",
          isCellActive && "text-destructive"
        )}
      />
    );
  }

  return getCellStatusIcon({
    agentStatus,
    cellStatus,
    isActive: isCellActive,
  });
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center px-3 py-4 text-muted-foreground text-xs">
      No workspaces registered
    </div>
  );
}

function getCellStatusIcon({
  cellStatus,
  agentStatus,
  isActive,
}: {
  cellStatus: CellStatus;
  agentStatus?: string;
  isActive: boolean;
}): ReactNode {
  const iconClass = cn(
    "size-4 shrink-0",
    isActive ? "text-foreground" : "text-muted-foreground/70"
  );

  if (cellStatus === "error") {
    return <CircleX className={cn(iconClass, "text-destructive")} />;
  }

  if (cellStatus === "pending") {
    return <Wrench className={cn(iconClass, "text-amber-400")} />;
  }

  if (cellStatus === "spawning") {
    return <Wrench className={cn(iconClass, "text-amber-400")} />;
  }

  if (agentStatus === "awaiting_input") {
    return <Check className={cn(iconClass, "text-teal-400")} />;
  }

  if (agentStatus === "working" || agentStatus === "starting") {
    return (
      <Loader2 className={cn(iconClass, "animate-spin text-primary/80")} />
    );
  }

  if (agentStatus === "error") {
    return <CircleX className={cn(iconClass, "text-destructive")} />;
  }

  return <Check className={cn(iconClass, "text-emerald-500")} />;
}

function getAgentStatusDotClass(status: string): string {
  switch (status) {
    case "working":
      return "bg-primary";
    case "awaiting_input":
      return "bg-secondary";
    case "completed":
      return "bg-primary/70";
    case "error":
      return "bg-destructive";
    case "starting":
      return "bg-muted";
    default:
      return "bg-border/60";
  }
}
