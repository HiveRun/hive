import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Loader2, MoreHorizontal, Plus } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
  const [selectedCellForMetadata, setSelectedCellForMetadata] =
    useState<Cell | null>(null);

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

  const allCells = cells ?? [];
  const selectedCells = allCells.filter((cell) => selectedCellIds.has(cell.id));
  const selectedCount = selectedCells.length;
  const hasSelection = selectedCount > 0;

  useEffect(() => {
    if (!hasSelection) {
      setIsBulkDialogOpen(false);
    }
  }, [hasSelection]);

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

  const handleBulkDelete = () => {
    if (!hasSelection) {
      toast.info("Select at least one cell to delete");
      return;
    }

    bulkDeleteMutation.mutate(selectedCells.map((cell) => cell.id));
  };

  const handleClearSelection = () => {
    setSelectedCellIds(new Set());
  };

  const handleSelectAll = () => {
    if (selectedCount === allCells.length) {
      setSelectedCellIds(new Set());
    } else {
      setSelectedCellIds(new Set(allCells.map((cell) => cell.id)));
    }
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
    <div className="flex h-full w-full flex-col space-y-6 overflow-y-auto p-4 md:p-6">
      <CellMetadataDialog
        isOpen={isMetadataModalOpen}
        onOpenChange={setIsMetadataModalOpen}
        selectedCell={selectedCellForMetadata}
      />
      <div className="flex flex-col gap-4">
        <h1 className="font-bold text-2xl md:text-3xl">Cells</h1>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              className="text-xs"
              data-testid="clear-selection"
              disabled={!hasSelection}
              onClick={handleClearSelection}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
            <Button
              className="text-xs"
              data-testid="select-all"
              disabled={allCells.length === 0}
              onClick={handleSelectAll}
              size="sm"
              type="button"
              variant="ghost"
            >
              {selectedCount === allCells.length
                ? "Unselect all"
                : "Select all"}
              <span className="ml-1.5 inline-flex h-4.5 min-w-[1.5rem] items-center justify-center rounded-sm border border-muted-foreground/40 bg-muted-foreground/10 px-0.5 font-mono text-[10px] tabular-nums">
                {selectedCount === allCells.length
                  ? selectedCount
                  : allCells.length}
              </span>
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground text-xs hover:bg-destructive/90"
              data-testid="delete-selected"
              disabled={!hasSelection || bulkDeleteMutation.isPending}
              onClick={() => hasSelection && setIsBulkDialogOpen(true)}
              size="sm"
              type="button"
              variant="destructive"
            >
              Delete
              <span
                className="ml-1.5 inline-flex h-4.5 min-w-[1.5rem] items-center justify-center rounded-sm border border-destructive-foreground/40 bg-destructive-foreground/10 px-0.5 font-mono text-[10px] tabular-nums"
                data-testid="delete-selected-count"
              >
                {selectedCount}
              </span>
            </Button>
          </div>

          <Link
            className="flex-none sm:flex-none"
            search={{ workspaceId }}
            to="/cells/new"
          >
            <Button className="w-auto" size="sm" type="button">
              <Plus className="mr-1.5 h-4 w-4" />
              New Cell
            </Button>
          </Link>
        </div>
      </div>

      <BulkDeleteDialog
        disableActions={bulkDeleteMutation.isPending}
        isOpen={isBulkDialogOpen && hasSelection}
        onConfirmDelete={handleBulkDelete}
        onOpenChange={setIsBulkDialogOpen}
        selectedCells={selectedCells}
        selectedCount={selectedCount}
      />

      <div className="space-y-10">
        <section className="space-y-3">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-xl">Cells</h2>
              <Badge variant="outline">{allCells.length}</Badge>
            </div>
            <p className="text-muted-foreground">
              Manage your workspaces and access services and chat.
            </p>
          </header>
          {allCells.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {allCells.map((cell) => (
                <CellCard
                  cell={cell}
                  disableSelection={bulkDeleteMutation.isPending}
                  isSelected={selectedCellIds.has(cell.id)}
                  key={cell.id}
                  onOpenMetadata={(c) => {
                    setSelectedCellForMetadata(c);
                    setIsMetadataModalOpen(true);
                  }}
                  onToggleSelect={() => toggleCellSelection(cell.id)}
                  serviceStatus={serviceStatusMap.get(cell.id)}
                  templateLabel={getTemplateLabel(cell.templateId)}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
                <p>No cells in this workspace.</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

type BulkDeleteDialogProps = {
  disableActions: boolean;
  isOpen: boolean;
  onConfirmDelete: () => void;
  onOpenChange: (open: boolean) => void;
  selectedCells: Cell[];
  selectedCount: number;
};

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
            This action removes the stored worktrees and metadata permanently.
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
  isSelected: boolean;
  disableSelection: boolean;
  onToggleSelect: () => void;
  serviceStatus?: ServiceStatusState;
  onOpenMetadata: (cell: Cell) => void;
};

function CellCard({
  cell,
  disableSelection,
  isSelected,
  onToggleSelect,
  templateLabel,
  serviceStatus,
  onOpenMetadata,
}: CellCardProps) {
  const sessionQueryConfig = agentQueries.sessionByCell(cell.id);
  const agentSessionQuery = useQuery({
    ...sessionQueryConfig,
    enabled: cell.status === "ready" && Boolean(cell.id),
    staleTime: 30_000,
  });
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
          <Button
            aria-label="Cell menu"
            className="ml-auto h-6 w-6 shrink-0 p-0"
            data-testid="cell-metadata"
            onClick={() => onOpenMetadata(cell)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className={cn(
              "w-fit",
              "border-primary/40 bg-primary/10 text-primary"
            )}
            data-testid="cell-status"
            variant="outline"
          >
            {cell.status}
          </Badge>
          <Badge
            className="w-fit"
            data-testid="cell-template"
            variant="secondary"
          >
            {templateLabel}
          </Badge>
        </div>
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

      <CardContent className="space-y-3">
        {cell.description && (
          <p
            className="line-clamp-2 break-words text-muted-foreground text-sm"
            data-testid="cell-description"
          >
            {cell.description}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
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
        </div>
      </CardContent>
    </Card>
  );
}

function CellMetadataDialog({
  isOpen,
  onOpenChange,
  selectedCell,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCell: Cell | null;
}) {
  if (!selectedCell) {
    return null;
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
      return;
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
      return;
    }
  };

  const connectionLabel = () => {
    const { hostname, port } = selectedCell.opencodeServerUrl
      ? (() => {
          try {
            const parsed = new URL(selectedCell.opencodeServerUrl);
            return {
              hostname: parsed.hostname,
              port: parsed.port || selectedCell.opencodeServerPort,
            };
          } catch {
            return { hostname: null, port: selectedCell.opencodeServerPort };
          }
        })()
      : { hostname: null, port: selectedCell.opencodeServerPort };

    if (!(hostname || port)) {
      return null;
    }
    if (hostname && port) {
      return `${hostname}:${port}`;
    }
    return hostname ?? port ?? null;
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selectedCell.name}</DialogTitle>
          <DialogDescription>Cell details and metadata</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
              Cell Info
            </h3>
            <div className="grid grid-cols-2 gap-4 text-muted-foreground text-xs">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.3em]">
                  ID
                </p>
                <p className="break-all font-mono text-foreground">
                  {selectedCell.id}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.3em]">
                  Status
                </p>
                <p>{selectedCell.status}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.3em]">
                  Template
                </p>
                <p>{selectedCell.templateId}</p>
              </div>
            </div>
          </div>
          {selectedCell.workspacePath && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
                Workspace
              </h3>
              <div className="rounded border border-border bg-muted/10 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-foreground">Path</p>
                  <Button
                    aria-label="Copy workspace path"
                    className="h-6 w-6 p-0"
                    onClick={() => handleCopy(selectedCell.workspacePath)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {selectedCell.workspacePath}
                </pre>
              </div>
            </div>
          )}
          {selectedCell.opencodeCommand && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
                OpenCode CLI
              </h3>
              <div className="rounded border border-border bg-muted/10 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-foreground">Command</p>
                  <Button
                    aria-label="Copy OpenCode CLI command"
                    className="h-6 w-6 p-0"
                    disabled={!selectedCell.opencodeCommand}
                    onClick={() =>
                      selectedCell.opencodeCommand &&
                      handleCopy(selectedCell.opencodeCommand)
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {selectedCell.opencodeCommand}
                </pre>
                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  <span>
                    Session · {selectedCell.opencodeSessionId ?? "pending"}
                  </span>
                  {connectionLabel() && (
                    <span>Server · {connectionLabel()}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          {selectedCell.branchName || selectedCell.baseCommit ? (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
                Git Info
              </h3>
              <div className="rounded border border-border bg-muted/10 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">Branch</p>
                  <p className="break-all font-mono text-foreground">
                    {selectedCell.branchName ?? "—"}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">Base Commit</p>
                  <p className="break-all font-mono text-foreground">
                    {selectedCell.baseCommit ?? "—"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CellStatusNotice({
  status,
  lastSetupError,
}: Pick<Cell, "status" | "lastSetupError">) {
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
