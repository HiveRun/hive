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
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);

  const queryClient = useQueryClient();

  const {
    data: cells,
    isLoading,
    error,
  } = useQuery({
    ...cellQueries.all(workspaceId),
    refetchInterval: (data) => {
      const hasProvisioningCells = Array.isArray(data)
        ? data.some((cell) => PROVISIONING_STATUSES.includes(cell.status))
        : false;
      return hasProvisioningCells ? PROVISIONING_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });
  const { data: templatesData } = useQuery(templateQueries.all(workspaceId));
  const templates = templatesData?.templates;

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
      return;
    }

    bulkDeleteMutation.mutate(Array.from(selectedCellIds));
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
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none"
              data-testid="delete-selected"
              disabled={!hasSelection}
              onClick={() => hasSelection && setIsBulkDialogOpen(true)}
              type="button"
              variant="destructive"
            >
              Delete Selected
              <span
                className="ml-2 inline-flex h-5 min-w-[2rem] items-center justify-center rounded-sm border border-destructive-foreground/40 bg-destructive-foreground/10 px-1 font-mono text-xs tabular-nums"
                data-testid="delete-selected-count"
              >
                {selectedCount}
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

      <BulkDeleteDialog
        disableActions={bulkDeleteMutation.isPending}
        isOpen={isBulkDialogOpen && hasSelection}
        onConfirmDelete={handleBulkDelete}
        onOpenChange={setIsBulkDialogOpen}
        selectedCells={selectedCells}
        selectedCount={selectedCount}
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
          {cells?.map((cell) => (
            <CellCard
              cell={cell}
              createdLabel={formatDate(cell.createdAt)}
              disableSelection={bulkDeleteMutation.isPending}
              isSelected={selectedCellIds.has(cell.id)}
              key={cell.id}
              onCopyWorkspace={copyToClipboard}
              onToggleSelect={() => toggleCellSelection(cell.id)}
              serviceStatus={serviceStatusMap.get(cell.id)}
              templateLabel={getTemplateLabel(cell.templateId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type BulkDeleteDialogProps = {
  disableActions: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  selectedCells: Cell[];
  selectedCount: number;
};

function BulkDeleteDialog({
  disableActions,
  isOpen,
  onOpenChange,
  onConfirmDelete,
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
            This action permanently removes the selected cells and their
            metadata. This cannot be undone.
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
  onToggleSelect: () => void;
  onCopyWorkspace: (path: string) => void;
  serviceStatus?: ServiceStatusState;
};

function CellCard({
  cell,
  createdLabel,
  disableSelection,
  isSelected,
  onCopyWorkspace,
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
            disabled={disableSelection}
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
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-muted-foreground text-xs">
                Workspace:
              </p>
              <Button
                className="h-7 w-7 p-0"
                data-testid="copy-workspace-path"
                onClick={() => onCopyWorkspace(cell.workspacePath)}
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
        )}

        <div className="text-muted-foreground text-xs">
          <p>Created: {createdLabel}</p>
        </div>
        <div className="flex justify-end gap-2">
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

  return null;
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

  const statusTheme = getStatusAppearance(session.status);

  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em]">
      <span
        className={cn(
          "inline-flex h-2 w-2 rounded-full",
          getStatusDotClass(session.status)
        )}
      />
      <span className={statusTheme.badge}>
        Agent {formatStatus(session.status)}
      </span>
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
