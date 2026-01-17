import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Cell } from "@/queries/cells";
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
      <div className="flex h-full w-full flex-col gap-4 px-4 py-3 text-muted-foreground text-sm">
        <header className="border-border/60 border-b pb-3">
          <h2 className="font-semibold text-foreground text-lg uppercase tracking-[0.3em]">
            Info
          </h2>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            Cell details, provisioning commands, and setup logs
          </p>
          {cell.lastSetupError ? (
            <p className="mt-2 text-destructive text-xs">
              Last setup error: {cell.lastSetupError}
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground text-xs">
              No recorded setup errors.
            </p>
          )}
        </header>

        <CellInfoSection cell={cell} templateLabel={templateLabel} />

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <TemplateCommandsPanel
            errorMessage={templateError}
            includeDirectories={includeDirectories}
            isLoading={templateQuery.isLoading}
            setupCommands={setupCommandItems}
          />
          <SetupLogPanel
            cell={cell}
            isRefreshing={cellQuery.isFetching}
            isRetrying={retryMutation.isPending}
            lastUpdatedLabel={lastUpdatedLabel}
            onRefresh={() => cellQuery.refetch()}
            onRetry={() => retryMutation.mutate(cellId)}
          />
        </div>
      </div>
    </div>
  );
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
    <section className="flex min-h-0 flex-col gap-3 border border-border/70 bg-muted/10 p-4">
      <div>
        <h3 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
          Template Commands
        </h3>
        {description}
      </div>
      {setupCommands.length > 0 ? (
        <ol className="min-h-0 space-y-3 overflow-auto">
          {setupCommands.map((item) => (
            <li
              className="space-y-2 rounded-sm border border-border/50 bg-background/40 px-3 py-2"
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
  isRefreshing: boolean;
  isRetrying: boolean;
  lastUpdatedLabel: string | null;
  onRefresh: () => void;
  onRetry: () => void;
};

function SetupLogPanel({
  cell,
  isRefreshing,
  isRetrying,
  lastUpdatedLabel,
  onRefresh,
  onRetry,
}: SetupLogPanelProps) {
  const [isLogExpanded, setIsLogExpanded] = useState(false);

  return (
    <details
      className="flex min-h-0 flex-col gap-3 border border-border/70 bg-muted/10 p-4"
      onToggle={(e) =>
        setIsLogExpanded((e.currentTarget as HTMLDetailsElement).open)
      }
      open={isLogExpanded}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
            Setup logs
          </h3>
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
            {cell.setupLogPath ?? "No log path yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isRetrying || isRefreshing}
              onClick={onRetry}
              size="sm"
              type="button"
              variant="secondary"
            >
              {isRetrying ? "Retrying…" : "Retry"}
            </Button>
            <Button
              disabled={isRefreshing || isRetrying}
              onClick={onRefresh}
              size="sm"
              type="button"
              variant="outline"
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isLogExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </summary>
      <p className="text-muted-foreground text-xs">
        Last updated {lastUpdatedLabel ?? "just now"}.
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-background/40">
        <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap p-3 text-[13px] text-foreground leading-relaxed">
          {cell.setupLog && cell.setupLog.length > 0
            ? cell.setupLog
            : "No setup log output yet."}
        </pre>
      </div>
    </details>
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

  const connectionLabel = () => {
    const { hostname, port } = cell.opencodeServerUrl
      ? (() => {
          try {
            const parsed = new URL(cell.opencodeServerUrl);
            return {
              hostname: parsed.hostname,
              port: parsed.port || cell.opencodeServerPort,
            };
          } catch {
            return { hostname: null, port: cell.opencodeServerPort };
          }
        })()
      : { hostname: null, port: cell.opencodeServerPort };

    if (!(hostname || port)) {
      return null;
    }
    if (hostname && port) {
      return `${hostname}:${port}`;
    }
    return hostname ?? port ?? null;
  };

  return (
    <section className="space-y-4 border border-border/70 bg-muted/10 p-4">
      <h2 className="font-semibold text-base text-foreground uppercase tracking-[0.25em]">
        Info
      </h2>

      <div className="space-y-3 text-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              ID
            </p>
            <Button
              aria-label="Copy cell ID"
              className="h-6 w-6 shrink-0 p-0"
              onClick={() => handleCopy(cell.id)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="inline-block min-w-0 max-w-full break-all font-mono text-foreground">
            {cell.id}
          </p>
        </div>

        {templateLabel && templateLabel !== "Hive Development Environment" ? (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Template
            </p>
            <div className="rounded border border-border bg-background/60 p-2">
              <p className="font-medium text-foreground">{templateLabel}</p>
            </div>
          </div>
        ) : null}

        {cell.workspacePath && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                Workspace path
              </p>
              <Button
                aria-label="Copy workspace path"
                className="h-6 w-6 shrink-0 p-0"
                onClick={() => handleCopy(cell.workspacePath)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <pre className="inline-block min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
              {cell.workspacePath}
            </pre>
          </div>
        )}

        {cell.opencodeCommand && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                OpenCode command
              </p>
              <Button
                aria-label="Copy OpenCode command"
                className="h-6 w-6 shrink-0 p-0"
                disabled={!cell.opencodeCommand}
                onClick={() =>
                  cell.opencodeCommand && handleCopy(cell.opencodeCommand)
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <pre className="inline-block min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
              {cell.opencodeCommand}
            </pre>
            {connectionLabel() ? (
              <div className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                Server · {connectionLabel()}
              </div>
            ) : null}
          </div>
        )}

        {cell.branchName || cell.baseCommit ? (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Git info
            </p>
            <div className="space-y-1 rounded border border-border bg-background/60 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-foreground">Branch</p>
                  <Button
                    aria-label="Copy branch name"
                    className="h-6 w-6 shrink-0 p-0"
                    disabled={!cell.branchName}
                    onClick={() =>
                      cell.branchName && handleCopy(cell.branchName)
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="break-all font-mono text-foreground">
                  {cell.branchName ?? "—"}
                </p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-foreground">Base commit</p>
                  <Button
                    aria-label="Copy base commit"
                    className="h-6 w-6 shrink-0 p-0"
                    disabled={!cell.baseCommit}
                    onClick={() =>
                      cell.baseCommit && handleCopy(cell.baseCommit)
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="break-all font-mono text-foreground">
                  {cell.baseCommit ?? "—"}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
