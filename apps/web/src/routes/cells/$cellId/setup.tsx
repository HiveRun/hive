import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PtyStreamTerminal } from "@/components/pty-stream-terminal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Cell, CellActivityEvent } from "@/queries/cells";
import { cellMutations, cellQueries } from "@/queries/cells";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/cells/$cellId/setup")({
  component: CellSetupPanel,
});

function CellSetupPanel() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const retryMutation = useMutation({
    mutationFn: cellMutations.retrySetup.mutationFn,
    onSuccess: (_updated) => {
      toast.success("Setup retried");
      cellQuery.refetch();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Retry failed";
      toast.error(message);
    },
  });

  const cell = cellQuery.data;
  const workspaceId = cell?.workspaceId ?? null;
  const templateQuery = useQuery({
    ...templateQueries.all(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });

  if (cellQuery.isLoading || !cell) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground text-sm">
        Loading cell info…
      </div>
    );
  }

  if (cellQuery.error instanceof Error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-destructive text-sm">
        {cellQuery.error.message}
      </div>
    );
  }

  const template = templateQuery.data?.templates.find(
    (entry) => entry.id === cell.templateId
  );
  const templateLabel = template?.label;
  const setupCommands = template?.configJson.setup ?? [];
  const setupCommandItems = setupCommands.map((command, index) => ({
    id: `${index}-${command}`,
    command,
    order: index + 1,
  }));
  const includeDirectories = template?.includeDirectories ?? [];
  const templateError =
    templateQuery.error instanceof Error
      ? templateQuery.error.message
      : undefined;
  const lastUpdatedLabel = cellQuery.dataUpdatedAt
    ? new Date(cellQuery.dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full w-full flex-col gap-3 px-4 py-3 text-muted-foreground text-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.3em]">
              Setup:
            </span>
            <span
              className={`rounded-sm border px-2 py-0.5 font-medium text-xs uppercase tracking-[0.2em] ${
                cell.lastSetupError
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
              }`}
            >
              {cell.lastSetupError ? "Error" : "OK"}
            </span>
          </div>
          {cell.lastSetupError && (
            <p className="w-full text-destructive text-xs">
              Last setup error: {cell.lastSetupError}
            </p>
          )}
        </header>

        <CellInfoSection cell={cell} templateLabel={templateLabel} />

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <TemplateCommandsPanel
            errorMessage={templateError}
            includeDirectories={includeDirectories}
            isLoading={templateQuery.isLoading}
            setupCommands={setupCommandItems}
          />
          <SetupLogPanel
            cell={cell}
            isRetrying={retryMutation.isPending}
            lastUpdatedLabel={lastUpdatedLabel}
            onRetry={() => retryMutation.mutate(cellId)}
          />
        </div>

        <CellActivityPanel cellId={cellId} />
      </div>
    </div>
  );
}

function CellActivityPanel({ cellId }: { cellId: string }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const activityQuery = useInfiniteQuery({
    queryKey: ["cells", cellId, "activity"] as const,
    enabled: isDialogOpen,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      cellQueries.activity(cellId, { limit: 20, cursor: pageParam }).queryFn(),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const events = activityQuery.data?.pages.flatMap((page) => page.events) ?? [];
  const hasNext = Boolean(activityQuery.hasNextPage);

  const isBusy = activityQuery.isFetching || activityQuery.isPending;

  let body: React.ReactNode;
  if (activityQuery.isPending) {
    body = <p className="text-muted-foreground text-xs">Loading activity…</p>;
  } else if (activityQuery.error instanceof Error) {
    body = (
      <p className="text-destructive text-xs">{activityQuery.error.message}</p>
    );
  } else if (events.length === 0) {
    body = <p className="text-muted-foreground text-xs">No activity yet.</p>;
  } else {
    body = (
      <ScrollArea className="max-h-[50vh] rounded-sm border border-border bg-background/40">
        <ol className="divide-y divide-border/60">
          {events.map((event) => (
            <ActivityEventRow event={event} key={event.id} />
          ))}
        </ol>
      </ScrollArea>
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-2 border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
            Activity
          </h3>
          <p className="text-muted-foreground text-xs">
            Meaningful events: restarts, setup retries, and tool log reads.
          </p>
        </div>

        <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
          <Button
            onClick={() => setIsDialogOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            View
          </Button>
          <DialogContent className="max-w-3xl rounded-sm border-2 border-border bg-card p-4 shadow-[2px_2px_0_rgba(0,0,0,0.6)] sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-foreground uppercase tracking-[0.25em]">
                Cell Activity
              </DialogTitle>
              <DialogDescription>
                Service lifecycle actions, setup retries, and tool-triggered log
                reads.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {body}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
                  {events.length} event{events.length === 1 ? "" : "s"}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={!hasNext || activityQuery.isFetchingNextPage}
                    onClick={() => activityQuery.fetchNextPage()}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {activityQuery.isFetchingNextPage
                      ? "Loading…"
                      : "Load more"}
                  </Button>
                  <Button
                    disabled={isBusy}
                    onClick={() => activityQuery.refetch()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                disabled={isBusy}
                onClick={() => setIsDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}

function ActivityEventRow({ event }: { event: CellActivityEvent }) {
  const createdAt = (() => {
    try {
      return new Date(event.createdAt).toLocaleString();
    } catch {
      return event.createdAt;
    }
  })();

  const details = describeActivityEvent(event);

  return (
    <li className="grid gap-2 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border/60 bg-background/60 px-2 py-1 font-medium text-[10px] text-foreground uppercase tracking-[0.35em]">
            {event.type}
          </span>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
            {createdAt}
          </span>
        </div>
        {event.toolName ? (
          <span className="rounded-sm border border-border/60 bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground">
            {event.toolName}
          </span>
        ) : null}
      </div>
      <p className="text-[13px] text-foreground leading-relaxed">{details}</p>
    </li>
  );
}

function describeActivityEvent(event: CellActivityEvent): string {
  const metadata =
    event.metadata && typeof event.metadata === "object"
      ? (event.metadata as Record<string, unknown>)
      : {};
  const serviceName =
    typeof metadata.serviceName === "string" ? metadata.serviceName : null;

  switch (event.type) {
    case "service.start":
      return serviceName ? `Started ${serviceName}.` : "Started a service.";
    case "service.stop":
      return serviceName ? `Stopped ${serviceName}.` : "Stopped a service.";
    case "service.restart":
      return serviceName ? `Restarted ${serviceName}.` : "Restarted a service.";
    case "services.start":
      return "Started all services.";
    case "services.stop":
      return "Stopped all services.";
    case "services.restart":
      return "Restarted all services.";
    case "setup.retry":
      return "Retried setup.";
    case "service.logs.read":
      return serviceName
        ? `Read logs for ${serviceName}.`
        : "Read service logs.";
    case "setup.logs.read":
      return "Read setup logs.";
    default:
      return "Recorded activity event.";
  }
}

type TemplateCommandsPanelProps = {
  errorMessage?: string;
  includeDirectories: string[];
  isLoading: boolean;
  setupCommands: Array<{ id: string; command: string; order: number }>;
};

function TemplateCommandsPanel({
  errorMessage,
  includeDirectories,
  isLoading,
  setupCommands,
}: TemplateCommandsPanelProps) {
  let description: React.ReactNode = null;
  if (errorMessage) {
    description = <p className="text-destructive text-xs">{errorMessage}</p>;
  } else if (isLoading) {
    description = (
      <p className="text-muted-foreground text-xs">Loading template…</p>
    );
  } else if (setupCommands.length === 0) {
    description = (
      <p className="text-muted-foreground text-xs">
        This template does not define any setup commands.
      </p>
    );
  } else {
    description = (
      <p className="text-muted-foreground text-xs">
        {setupCommands.length} command{setupCommands.length === 1 ? "" : "s"}{" "}
        will run before services start.
      </p>
    );
  }

  return (
    <section className="flex min-h-0 flex-col gap-2 border border-border/70 bg-muted/10 p-3">
      <div>
        <h3 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
          Template Commands
        </h3>
        {description}
      </div>
      {setupCommands.length > 0 ? (
        <ol className="min-h-0 space-y-2 overflow-auto">
          {setupCommands.map((item) => (
            <li
              className="space-y-1 rounded-sm border border-border/50 bg-background/40 px-2.5 py-2"
              key={item.id}
            >
              <span className="text-[11px] text-muted-foreground uppercase tracking-[0.4em]">
                Step {item.order}
              </span>
              <pre className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
                {item.command}
              </pre>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-auto space-y-2">
        <h4 className="font-semibold text-foreground text-xs uppercase tracking-[0.3em]">
          Included directories
        </h4>
        {includeDirectories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {includeDirectories.map((dir) => (
              <span
                className="rounded-sm border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-foreground uppercase tracking-[0.3em]"
                key={dir}
              >
                {dir}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            No includePatterns defined for this template.
          </p>
        )}
      </div>
    </section>
  );
}

type SetupLogPanelProps = {
  cell: Cell;
  isRetrying: boolean;
  lastUpdatedLabel: string | null;
  onRetry: () => void;
};

function SetupLogPanel({
  cell,
  isRetrying,
  lastUpdatedLabel,
  onRetry,
}: SetupLogPanelProps) {
  return (
    <section className="flex min-h-0 flex-col gap-2 border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
          Setup logs
        </h3>
        <Button
          disabled={isRetrying}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="secondary"
        >
          {isRetrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Last updated {lastUpdatedLabel ?? "just now"}.
      </p>
      <PtyStreamTerminal
        allowInput
        emptyMessage="Setup output will appear when setup runs."
        inputPath={`/api/cells/${cell.id}/setup/terminal/input`}
        mode="setup"
        resizePath={`/api/cells/${cell.id}/setup/terminal/resize`}
        streamPath={`/api/cells/${cell.id}/setup/terminal/stream`}
        title="Setup Terminal"
      />
    </section>
  );
}

type CellInfoSectionProps = {
  cell: Cell;
  templateLabel?: string;
};

function CellInfoSection({ cell, templateLabel }: CellInfoSectionProps) {
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <section className="grid gap-2.5 border border-border/70 bg-muted/10 p-3 text-xs">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            ID
          </p>
          <Button
            aria-label="Copy cell ID"
            className="h-5 w-5 shrink-0 p-0"
            onClick={() => handleCopy(cell.id)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
        <p className="break-all font-mono text-[11px] text-foreground">
          {cell.id}
        </p>

        {templateLabel && templateLabel !== "Hive Development Environment" && (
          <>
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Template
            </p>
            <p className="font-medium text-foreground">{templateLabel}</p>
          </>
        )}

        {cell.workspacePath && (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                Workspace path
              </p>
              <Button
                aria-label="Copy workspace path"
                className="h-5 w-5 shrink-0 p-0"
                onClick={() => handleCopy(cell.workspacePath)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
              {cell.workspacePath}
            </pre>
          </>
        )}

        {cell.opencodeCommand && (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                OpenCode command
              </p>
              <Button
                aria-label="Copy OpenCode command"
                className="h-5 w-5 shrink-0 p-0"
                disabled={!cell.opencodeCommand}
                onClick={() =>
                  cell.opencodeCommand && handleCopy(cell.opencodeCommand)
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-0.5">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                {cell.opencodeCommand}
              </pre>
            </div>
          </>
        )}

        {cell.branchName && (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                Branch
              </p>
              <Button
                aria-label="Copy branch name"
                className="h-5 w-5 shrink-0 p-0"
                disabled={!cell.branchName}
                onClick={() => cell.branchName && handleCopy(cell.branchName)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="break-all font-mono text-[11px] text-foreground">
              {cell.branchName}
            </p>
          </>
        )}

        {cell.baseCommit && (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                Base commit
              </p>
              <Button
                aria-label="Copy base commit"
                className="h-5 w-5 shrink-0 p-0"
                disabled={!cell.baseCommit}
                onClick={() => cell.baseCommit && handleCopy(cell.baseCommit)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="break-all font-mono text-[11px] text-foreground">
              {cell.baseCommit}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
