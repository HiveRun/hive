import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  formatStatus,
  getStatusAppearance,
} from "@/components/agent-chat/status-theme";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { agentQueries } from "@/queries/agents";
import {
  type Cell,
  type CellServiceSummary,
  type CellStatus,
  cellMutations,
  cellQueries,
} from "@/queries/cells";
import { templateQueries } from "@/queries/templates";

const MAX_SELECTION_PREVIEW = 3;
const PROVISIONING_STATUSES: CellStatus[] = ["spawning", "pending"];
const PROVISIONING_POLL_INTERVAL_MS = 1000;

type ServiceStatusSummary = {
  total: number;
  running: number;
  pending: number;
  stopped: number;
  error: number;
};

type ServiceStatusState = {
  summary?: ServiceStatusSummary;
  isLoading: boolean;
  isError: boolean;
};

type CellListProps = {
  workspaceId: string;
};

export function CellList({ workspaceId }: CellListProps) {
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isBulkArchiveOpen, setIsBulkArchiveOpen] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);

  const queryClient = useQueryClient();

  const {
    data: cells,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...cellQueries.all(workspaceId),
  });
  const { data: templatesData } = useQuery(templateQueries.all(workspaceId));
  const templates = templatesData?.templates;

  useEffect(() => {
    const hasProvisioningCells = cells?.some((cell) =>
      PROVISIONING_STATUSES.includes(cell.status)
    );

    if (!hasProvisioningCells) {
      return;
    }

    const intervalId = setInterval(() => {
      refetch({ cancelRefetch: false });
    }, PROVISIONING_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [cells, refetch]);

  const serviceStatusQueries = useQueries({
    queries:
      cells?.map((cell) => {
        const config = cellQueries.services(cell.id);
        return {
          queryKey: config.queryKey,
          queryFn: config.queryFn,
          select: summarizeServices,
          enabled: cell.status === "ready" && Boolean(cell.id),
          staleTime: 15_000,
        };
      }) ?? [],
  });

  const serviceStatusMap = new Map<string, ServiceStatusState>();

  cells?.forEach((cell, index) => {
    const serviceQuery = serviceStatusQueries[index];
    if (serviceQuery) {
      serviceStatusMap.set(cell.id, {
        summary: serviceQuery.data,
        isLoading: serviceQuery.isLoading,
        isError: serviceQuery.isError,
      });
    }
  });

  useEffect(() => {
    if (!cells) {
      setSelectedCellIds((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        return new Set();
      });
      return;
    }

    const validIds = new Set(cells.map((cell) => cell.id));
    setSelectedCellIds((prev) => {
      const filtered = [...prev].filter((id) => validIds.has(id));
      if (filtered.length === prev.size) {
        return prev;
      }
      return new Set(filtered);
    });
  }, [cells]);

  const selectedCells =
    cells?.filter((cell) => selectedCellIds.has(cell.id)) ?? [];
  const selectedCount = selectedCells.length;
  const hasSelection = selectedCount > 0;
  const archivableSelection = selectedCells.filter(
    (cell) => cell.status !== "archived"
  );
  const deletableSelection = selectedCells.filter(
    (cell) => cell.status === "archived"
  );
  const archivableSelectionCount = archivableSelection.length;
  const deletableSelectionCount = deletableSelection.length;
  const canArchiveSelection = archivableSelectionCount > 0;
  const canDeleteSelection =
    hasSelection && deletableSelectionCount === selectedCount;

  useEffect(() => {
    if (!hasSelection) {
      setIsBulkDialogOpen(false);
      return;
    }
    if (!canDeleteSelection) {
      setIsBulkDialogOpen(false);
    }
  }, [hasSelection, canDeleteSelection]);

  useEffect(() => {
    if (!canArchiveSelection && isBulkArchiveOpen) {
      setIsBulkArchiveOpen(false);
    }
  }, [canArchiveSelection, isBulkArchiveOpen]);

  const archiveManyMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const updates: Cell[] = [];
      for (const id of ids) {
        const updated = await cellMutations.archive.mutationFn(id);
        updates.push(updated);
      }
      return updates;
    },
    onSuccess: (updatedCells) => {
      for (const cell of updatedCells) {
        queryClient.setQueryData(cellQueries.detail(cell.id).queryKey, cell);
      }
      queryClient.invalidateQueries({ queryKey: ["cells", workspaceId] });
      setSelectedCellIds((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        const next = new Set(prev);
        for (const cell of updatedCells) {
          next.delete(cell.id);
        }
        return next;
      });
      setIsBulkArchiveOpen(false);
      const count = updatedCells.length;
      const label = count === 1 ? "cell" : "cells";
      toast.success(`Archived ${count} ${label}`);
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to archive cells";
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    ...cellMutations.delete,
    onSuccess: (_response, deletedId) => {
      const cachedDetail = queryClient.getQueryData<Cell>(
        cellQueries.detail(deletedId).queryKey
      );
      toast.success(`Deleted ${cachedDetail?.name ?? "cell"}`);
      queryClient.invalidateQueries({ queryKey: ["cells", workspaceId] });
      queryClient.removeQueries({
        queryKey: cellQueries.detail(deletedId).queryKey,
      });
      setSelectedCellIds((prev) => {
        if (!prev.has(deletedId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(deletedId);
        return next;
      });
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to delete cell";
      toast.error(message);
    },
  });

  const bulkDeleteMutation = useMutation({
    ...cellMutations.deleteMany,
    onSuccess: (data: { deletedIds: string[] }) => {
      const count = data.deletedIds.length;
      const label = count === 1 ? "cell" : "cells";
      toast.success(`Deleted ${count} ${label}`);
      queryClient.invalidateQueries({ queryKey: ["cells", workspaceId] });
      setSelectedCellIds(new Set());
      setIsBulkDialogOpen(false);
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to delete cells";
      toast.error(message);
    },
  });

  const handleArchiveSelected = () => {
    if (!canArchiveSelection) {
      toast.info("Select at least one active cell to archive");
      return;
    }

    setIsBulkArchiveOpen(true);
  };

  const confirmArchiveSelected = () => {
    if (!canArchiveSelection) {
      toast.info("Select at least one active cell to archive");
      return;
    }
    archiveManyMutation.mutate(archivableSelection.map((cell) => cell.id));
  };

  const handleBulkDelete = () => {
    if (!canDeleteSelection) {
      toast.info("Select only archived cells to delete");
      return;
    }

    bulkDeleteMutation.mutate(deletableSelection.map((cell) => cell.id));
  };

  const handleClearSelection = () => {
    setSelectedCellIds(new Set());
  };

  const handleSelectAllToggle = () => {
    if (!cells?.length) {
      return;
    }

    setSelectedCellIds((prev) => {
      if (prev.size === cells.length) {
        return new Set();
      }
      return new Set(cells.map((cell) => cell.id));
    });
  };

  const toggleCellSelection = (cellId: string) => {
    setSelectedCellIds((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      return next;
    });
  };

  const getTemplateLabel = (templateId: string) =>
    templates?.find((template) => template.id === templateId)?.label ??
    templateId;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading cells...</div>;
  }

  if (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load cells";
    return (
      <div className="p-6 text-destructive">Error loading cells: {message}</div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-bold text-2xl md:text-3xl">Cells</h1>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="flex-1 sm:flex-none"
              data-testid="clear-selection"
              disabled={!hasSelection}
              onClick={handleClearSelection}
              type="button"
              variant="outline"
            >
              Clear Selection
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              data-testid="archive-selected"
              disabled={
                !canArchiveSelection ||
                archiveManyMutation.isPending ||
                bulkDeleteMutation.isPending
              }
              onClick={handleArchiveSelected}
              type="button"
              variant="secondary"
            >
              Archive Selected
              <span
                className="ml-2 inline-flex h-5 min-w-[2rem] items-center justify-center rounded-sm border border-secondary/40 bg-secondary/10 px-1 font-mono text-xs tabular-nums"
                data-testid="archive-selected-count"
              >
                {archivableSelectionCount}
              </span>
            </Button>
            <Button
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none"
              data-testid="delete-selected"
              disabled={
                !canDeleteSelection ||
                bulkDeleteMutation.isPending ||
                archiveManyMutation.isPending
              }
              onClick={() => canDeleteSelection && setIsBulkDialogOpen(true)}
              type="button"
              variant="destructive"
            >
              Delete Selected
              <span
                className="ml-2 inline-flex h-5 min-w-[2rem] items-center justify-center rounded-sm border border-destructive-foreground/40 bg-destructive-foreground/10 px-1 font-mono text-xs tabular-nums"
                data-testid="delete-selected-count"
              >
                {deletableSelectionCount}
              </span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {cells && cells.length > 0 && (
              <Button
                className="flex-1 sm:flex-none"
                data-testid="toggle-select-all-global"
                onClick={handleSelectAllToggle}
                type="button"
                variant="outline"
              >
                Select All
              </Button>
            )}
            <Link className="flex-1 sm:flex-none" to="/cells/new">
              <Button className="w-full" type="button">
                <Plus className="mr-2 h-4 w-4" />
                New Cell
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <BulkArchiveDialog
        disableActions={archiveManyMutation.isPending}
        isOpen={isBulkArchiveOpen && canArchiveSelection}
        onConfirmArchive={confirmArchiveSelected}
        onOpenChange={setIsBulkArchiveOpen}
        selectedCells={archivableSelection}
        selectedCount={archivableSelectionCount}
      />

      <BulkDeleteDialog
        disableActions={bulkDeleteMutation.isPending}
        isOpen={isBulkDialogOpen && canDeleteSelection}
        onConfirmDelete={handleBulkDelete}
        onOpenChange={setIsBulkDialogOpen}
        selectedCells={deletableSelection}
        selectedCount={deletableSelectionCount}
      />

      {cells && cells.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="mb-2 font-semibold text-lg">No cells yet</h3>
            <p className="mb-4 text-center text-muted-foreground">
              Create your first cell to get started with Hive.
            </p>
            <Link to="/cells/new">
              <Button type="button">
                <Plus className="mr-2 h-4 w-4" />
                Create Cell
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {cells?.map((cell) => {
            const isDeleting =
              deleteMutation.isPending && deleteMutation.variables === cell.id;
            return (
              <CellCard
                cell={cell}
                createdLabel={formatDate(cell.createdAt)}
                disableSelection={bulkDeleteMutation.isPending}
                isDeleting={isDeleting}
                isSelected={selectedCellIds.has(cell.id)}
                key={cell.id}
                onCopyText={copyToClipboard}
                onDelete={() => deleteMutation.mutate(cell.id)}
                onToggleSelect={() => toggleCellSelection(cell.id)}
                serviceStatus={serviceStatusMap.get(cell.id)}
                templateLabel={getTemplateLabel(cell.templateId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

type BulkArchiveDialogProps = {
  disableActions: boolean;
  isOpen: boolean;
  onConfirmArchive: () => void;
  onOpenChange: (open: boolean) => void;
  selectedCells: Cell[];
  selectedCount: number;
};

type BulkDeleteDialogProps = {
  disableActions: boolean;
  isOpen: boolean;
  onConfirmDelete: () => void;
  onOpenChange: (open: boolean) => void;
  selectedCells: Cell[];
  selectedCount: number;
};

function BulkArchiveDialog({
  disableActions,
  isOpen,
  onConfirmArchive,
  onOpenChange,
  selectedCells,
  selectedCount,
}: BulkArchiveDialogProps) {
  const archivedTargets = selectedCells.filter(
    (cell) => cell.status === "archived"
  );
  return (
    <AlertDialog onOpenChange={onOpenChange} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Archive {selectedCount} {selectedCount === 1 ? "cell" : "cells"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Archiving stops services, preserves the worktree, and blocks future
            chat interactions until you delete or restore the cell.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-48 overflow-y-auto rounded border border-border/40 bg-muted/10 p-3 text-xs">
          <ul className="space-y-1">
            {selectedCells.map((cell) => (
              <li
                className="flex items-center justify-between gap-2"
                key={cell.id}
              >
                <span className="font-medium text-foreground">{cell.name}</span>
                <Badge variant="outline">{cell.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
        {archivedTargets.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {archivedTargets.length} already archived; confirming again keeps
            them read-only.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disableActions} type="button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            data-testid="confirm-archive-selected"
            disabled={disableActions}
            onClick={onConfirmArchive}
          >
            {disableActions ? "Archiving…" : "Archive"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BulkDeleteDialog({
  disableActions,
  isOpen,
  onConfirmDelete,
  onOpenChange,
  selectedCells,
  selectedCount,
}: BulkDeleteDialogProps) {
  if (!selectedCount) {
    return null;
  }

  const selectionPreview = selectedCells.slice(0, MAX_SELECTION_PREVIEW);
  const overflowCount = selectedCount - selectionPreview.length;

  return (
    <AlertDialog onOpenChange={onOpenChange} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {selectedCount} {selectedCount === 1 ? "cell" : "cells"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Only archived cells can be deleted. This action removes the stored
            worktrees and metadata permanently.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-muted bg-muted/30 p-4 text-sm">
          <p className="font-semibold">Selection Summary</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {selectionPreview.map((cell) => (
              <li key={cell.id}>{cell.name}</li>
            ))}
            {overflowCount > 0 && <li>+{overflowCount} more</li>}
          </ul>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disableActions} type="button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="confirm-bulk-delete"
            disabled={disableActions}
            onClick={onConfirmDelete}
          >
            {disableActions ? "Deleting..." : `Delete ${selectedCount}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type CellCardProps = {
  cell: Cell;
  templateLabel: string;
  createdLabel: string;
  isSelected: boolean;
  disableSelection: boolean;
  isDeleting?: boolean;
  onDelete?: () => void;
  onToggleSelect: () => void;
  onCopyText: (value: string) => void;
  serviceStatus?: ServiceStatusState;
};

function CellCard({
  cell,
  createdLabel,
  disableSelection,
  isDeleting = false,
  isSelected,
  onDelete,
  onCopyText,
  onToggleSelect,
  templateLabel,
  serviceStatus,
}: CellCardProps) {
  const sessionQueryConfig = agentQueries.sessionByCell(cell.id);
  const agentSessionQuery = useQuery({
    ...sessionQueryConfig,
    enabled: cell.status === "ready" && Boolean(cell.id),
    staleTime: 30_000,
  });
  const opencodeCommand = cell.opencodeCommand ?? null;
  const connectionLabel = describeServerConnection(cell);
  const isArchived = cell.status === "archived";
  const selectionDisabled = disableSelection;
  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        isSelected && "border-primary bg-primary/5 shadow-sm"
      )}
      data-testid="cell-card"
    >
      <CardHeader className="space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox
            aria-label={`Select cell ${cell.name}`}
            checked={isSelected}
            className="mt-0.5 h-5 w-5 shrink-0 border-2 border-muted-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            data-cell-id={cell.id}
            data-testid="cell-select"
            disabled={selectionDisabled}
            onCheckedChange={() => onToggleSelect()}
          />
          <CardTitle
            className="break-words text-lg leading-tight"
            data-testid="cell-name"
          >
            {cell.name}
          </CardTitle>
        </div>
        <Badge
          className="w-fit"
          data-testid="cell-template"
          variant="secondary"
        >
          {templateLabel}
        </Badge>
        <CellStatusNotice
          lastSetupError={cell.lastSetupError}
          status={cell.status}
        />
        {cell.status === "ready" && (
          <>
            <AgentStatusIndicator
              isError={agentSessionQuery.isError}
              isLoading={agentSessionQuery.isLoading}
              session={agentSessionQuery.data ?? null}
            />
            <ServiceStatusIndicator status={serviceStatus} />
          </>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {cell.description && (
          <p
            className="line-clamp-3 break-words text-muted-foreground text-sm"
            data-testid="cell-description"
          >
            {cell.description}
          </p>
        )}

        {cell.workspacePath && (
          <div className="space-y-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-muted-foreground text-xs">
                  Workspace
                </p>
                <Button
                  className="h-7 w-7 p-0"
                  data-testid="copy-workspace-path"
                  onClick={() => onCopyText(cell.workspacePath)}
                  size="sm"
                  title="Copy workspace path"
                  type="button"
                  variant="ghost"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="mt-1 overflow-hidden break-all rounded bg-muted/50 p-2 font-mono text-muted-foreground text-xs">
                {cell.workspacePath}
              </p>
            </div>

            <div className="space-y-2 rounded border border-border/70 bg-background/70 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
                    OpenCode CLI
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 uppercase tracking-[0.3em]">
                    {opencodeCommand
                      ? "Copy command to resume in TUI"
                      : "Session must be running"}
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  data-testid="copy-opencode-command"
                  disabled={!opencodeCommand}
                  onClick={() => opencodeCommand && onCopyText(opencodeCommand)}
                  size="sm"
                  title={
                    opencodeCommand
                      ? "Copy OpenCode CLI command"
                      : "OpenCode session not ready"
                  }
                  type="button"
                  variant="outline"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy CLI
                </Button>
              </div>
              <pre className="min-h-[2.5rem] overflow-x-auto whitespace-pre-wrap break-all rounded border border-border/40 bg-card/70 p-2 font-mono text-[11px] text-muted-foreground">
                {opencodeCommand ?? "OpenCode session not available"}
              </pre>
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                <span>Session · {cell.opencodeSessionId ?? "pending"}</span>
                {connectionLabel ? (
                  <span>Server · {connectionLabel}</span>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="text-muted-foreground text-xs">
          <p>Created: {createdLabel}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {isArchived ? (
            <ArchivedActions
              cellName={cell.name}
              isDeleting={isDeleting}
              onDelete={onDelete}
            />
          ) : (
            <>
              <Link params={{ cellId: cell.id }} to="/cells/$cellId/services">
                <Button size="sm" type="button" variant="secondary">
                  Services Panel
                </Button>
              </Link>
              <Link params={{ cellId: cell.id }} to="/cells/$cellId/chat">
                <Button size="sm" type="button" variant="outline">
                  Open Chat
                </Button>
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type ArchivedActionsProps = {
  cellName: string;
  isDeleting: boolean;
  onDelete?: () => void;
};

function ArchivedActions({
  cellName,
  isDeleting,
  onDelete,
}: ArchivedActionsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  return (
    <>
      <Button disabled size="sm" type="button" variant="ghost">
        Services Unavailable
      </Button>
      <Button disabled size="sm" type="button" variant="ghost">
        Chat Unavailable
      </Button>
      {onDelete ? (
        <AlertDialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              size="sm"
              type="button"
              variant="destructive"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {cellName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the archived worktree and cell metadata. The action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting} type="button">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="confirm-delete-archived"
                disabled={isDeleting}
                onClick={() => {
                  setIsDialogOpen(false);
                  onDelete();
                }}
              >
                {isDeleting ? "Deleting…" : "Delete cell"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function CellStatusNotice({
  status,
  lastSetupError,
}: Pick<Cell, "status" | "lastSetupError">) {
  if (status === "archived") {
    return (
      <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3">
        <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
          Archived
        </p>
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
          Worktree preserved; services and chat are disabled until deleted
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p className="font-semibold text-[11px] text-destructive uppercase tracking-[0.3em]">
          Setup failed
        </p>
        {lastSetupError && (
          <p className="line-clamp-4 whitespace-pre-wrap text-destructive text-xs">
            {lastSetupError}
          </p>
        )}
        <p className="text-[11px] text-destructive/70 uppercase tracking-[0.3em]">
          Fix workspace and rerun setup
        </p>
      </div>
    );
  }

  if (status === "spawning" || status === "pending") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <div className="space-y-1">
          <p className="font-semibold text-[11px] text-primary uppercase tracking-[0.3em]">
            Spawning cell
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Setup tasks running in background
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
      <p className="font-semibold text-[11px] text-accent uppercase tracking-[0.3em]">
        Ready
      </p>
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        Cell is ready for interaction
      </p>
    </div>
  );
}

function describeServerConnection(cell: Cell): string | null {
  const { hostname, port } = deriveServerOptions(cell);
  if (!(hostname || port)) {
    return null;
  }
  if (hostname && port) {
    return `${hostname}:${port}`;
  }
  return hostname ?? port ?? null;
}

function deriveServerOptions(
  cell: Pick<Cell, "opencodeServerUrl" | "opencodeServerPort">
): { hostname?: string; port?: string } {
  const options: { hostname?: string; port?: string } = {};

  if (cell.opencodeServerUrl) {
    try {
      const parsed = new URL(cell.opencodeServerUrl);
      if (parsed.hostname) {
        options.hostname = parsed.hostname;
      }
      if (parsed.port) {
        options.port = parsed.port;
      }
    } catch {
      // ignore invalid url fragments; fallback to explicit port if provided
    }
  }

  if (cell.opencodeServerPort) {
    options.port = String(cell.opencodeServerPort);
  }

  return options;
}

function AgentStatusIndicator({
  session,
  isLoading,
  isError,
}: {
  session: import("@/queries/agents").AgentSession | null;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        Checking agent…
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-[11px] text-destructive uppercase tracking-[0.3em]">
        Agent unavailable
      </p>
    );
  }

  if (!session) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        No agent running
      </p>
    );
  }

  const { badge } = getStatusAppearance(session.status);

  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em]">
      <span
        className={cn(
          "inline-flex h-2 w-2 rounded-full",
          getStatusDotClass(session.status)
        )}
      />
      <span className={badge}>Agent {formatStatus(session.status)}</span>
    </div>
  );
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case "working":
      return "bg-primary";
    case "awaiting_input":
      return "bg-secondary";
    case "completed":
      return "bg-accent";
    case "error":
      return "bg-destructive";
    case "starting":
      return "bg-muted";
    default:
      return "bg-border/60";
  }
}

function ServiceStatusIndicator({ status }: { status?: ServiceStatusState }) {
  if (!status) {
    return null;
  }

  if (status.isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        Checking services…
      </p>
    );
  }

  if (status.isError) {
    return (
      <p className="text-[11px] text-destructive uppercase tracking-[0.3em]">
        Service status unavailable
      </p>
    );
  }

  const summary = status.summary;
  if (!summary || summary.total === 0) {
    return (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
        No services configured
      </p>
    );
  }

  const health = describeServiceHealth(summary);

  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em]">
      <span
        className={cn("inline-flex h-2 w-2 rounded-full", health.dotClass)}
      />
      <span className={health.textClass}>{health.label}</span>
    </div>
  );
}

function summarizeServices(
  services: CellServiceSummary[]
): ServiceStatusSummary {
  const summary: ServiceStatusSummary = {
    total: services.length,
    running: 0,
    pending: 0,
    stopped: 0,
    error: 0,
  };

  for (const service of services) {
    const normalized = service.status.toLowerCase();
    if (normalized === "running") {
      summary.running += 1;
      continue;
    }
    if (normalized === "error") {
      summary.error += 1;
      continue;
    }
    if (
      normalized === "starting" ||
      normalized === "pending" ||
      normalized === "needs_resume"
    ) {
      summary.pending += 1;
      continue;
    }
    summary.stopped += 1;
  }

  return summary;
}

function describeServiceHealth(summary: ServiceStatusSummary) {
  if (summary.error > 0) {
    return {
      label: `${summary.error}/${summary.total} error`,
      dotClass: "bg-destructive",
      textClass: "text-destructive",
    };
  }

  if (summary.pending > 0) {
    return {
      label: `Starting ${summary.pending}/${summary.total}`,
      dotClass: "bg-secondary",
      textClass: "text-secondary-foreground",
    };
  }

  if (summary.running === summary.total && summary.total > 0) {
    return {
      label: "All services running",
      dotClass: "bg-primary",
      textClass: "text-primary",
    };
  }

  if (summary.running === 0) {
    return {
      label: "Services stopped",
      dotClass: "bg-border",
      textClass: "text-muted-foreground",
    };
  }

  return {
    label: `${summary.running}/${summary.total} running`,
    dotClass: "bg-accent",
    textClass: "text-accent-foreground",
  };
}
