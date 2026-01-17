import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Copy, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Cell } from "@/queries/cells";
import { cellQueries } from "@/queries/cells";
import { templateQueries } from "@/queries/templates";

export const Route = createFileRoute("/cells/$cellId")({
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/cells/${params.cellId}`) {
      throw redirect({
        to: "/cells/$cellId/chat",
        params,
      });
    }
  },
  loader: async ({ params, context: { queryClient } }) => {
    const cell = await queryClient.ensureQueryData(
      cellQueries.detail(params.cellId)
    );
    await queryClient.ensureQueryData(templateQueries.all(cell.workspaceId));
    return { workspaceId: cell.workspaceId };
  },
  component: CellLayout,
});

function CellLayout() {
  const { cellId } = Route.useParams();
  const { workspaceId } = Route.useLoaderData();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const templatesQuery = useQuery(templateQueries.all(workspaceId));
  const routerState = useRouterState();
  const activeRouteId = routerState.matches.at(-1)?.routeId;
  const [isMetadataDialogOpen, setIsMetadataDialogOpen] = useState(false);

  const cell = cellQuery.data;
  const templates = templatesQuery.data?.templates ?? [];

  const templateLabel = templates.find(
    (template) => template.id === cell?.templateId
  )?.label;
  const navItems = [
    {
      routeId: "/cells/$cellId/setup",
      label: "Setup",
      to: "/cells/$cellId/setup",
    },
    {
      routeId: "/cells/$cellId/services",
      label: "Services",
      to: "/cells/$cellId/services",
    },
    {
      routeId: "/cells/$cellId/viewer",
      label: "Viewer",
      to: "/cells/$cellId/viewer",
    },
    {
      routeId: "/cells/$cellId/diff",
      label: "Diff",
      to: "/cells/$cellId/diff",
    },
    {
      routeId: "/cells/$cellId/chat",
      label: "Chat",
      to: "/cells/$cellId/chat",
    },
  ];
  const isArchived = cell?.status === "archived";
  const branchLabel = cell?.branchName ?? `cell-${cellId}`;
  const baseCommitLabel = cell?.baseCommit ?? "unknown base";

  if (!cell) {
    return (
      <div className="flex h-full w-full flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center border-2 border-border bg-card p-6 text-muted-foreground text-sm">
          Unable to load cell. It may have been deleted.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
        <section className="w-full shrink-0 border-2 border-border bg-card px-4 py-3 text-muted-foreground text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-semibold text-2xl text-foreground tracking-wide">
                {cell.name}
              </h1>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Cell menu"
                      className="h-6 w-6 shrink-0 p-0"
                      onClick={() => setIsMetadataDialogOpen(true)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Cell menu</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {cell.description ? (
              <p className="max-w-3xl text-muted-foreground text-sm">
                {cell.description}
              </p>
            ) : null}
          </div>
        </section>

        {isArchived ? (
          <div className="rounded-md border border-border/70 bg-muted/10 p-4 text-muted-foreground text-sm">
            <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
              Archived cell
            </p>
            <p className="text-[12px] text-muted-foreground">
              The worktree remains on disk for offline analysis. Branch{" "}
              {branchLabel} and base commit {baseCommitLabel} stay available
              until you delete this cell.
            </p>
          </div>
        ) : null}

        {isArchived ? null : (
          <>
            <div className="flex flex-wrap justify-end gap-2">
              {navItems.map((item) => (
                <Link key={item.routeId} params={{ cellId }} to={item.to}>
                  <Button
                    variant={
                      activeRouteId === item.routeId ? "secondary" : "outline"
                    }
                  >
                    {item.label}
                  </Button>
                </Link>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </div>
          </>
        )}
        <CellMetadataDialog
          cell={cell}
          isOpen={isMetadataDialogOpen}
          onOpenChange={setIsMetadataDialogOpen}
          templateLabel={templateLabel}
        />
      </div>
    </div>
  );
}

function CellMetadataDialog({
  isOpen,
  onOpenChange,
  cell,
  templateLabel,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  cell: Cell;
  templateLabel?: string;
}) {
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
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cell.name}</DialogTitle>
          <DialogDescription>Cell details and metadata</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
              Cell Info
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  ID
                </p>
                <div className="flex items-center gap-2">
                  <p className="break-all font-mono text-foreground">
                    {cell.id}
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
              </div>
            </div>
          </div>
          {templateLabel && templateLabel !== "Hive Development Environment" ? (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
                Template
              </h3>
              <div className="rounded border border-border bg-muted/10 p-3 text-xs">
                <p className="font-medium text-foreground">
                  {templateLabel ?? cell.templateId}
                </p>
              </div>
            </div>
          ) : null}
          {cell.workspacePath && (
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
                    onClick={() => handleCopy(cell.workspacePath)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {cell.workspacePath}
                </pre>
              </div>
            </div>
          )}
          {cell.opencodeCommand && (
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
                <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                  {cell.opencodeCommand}
                </pre>
                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
                  <span>Session · {cell.opencodeSessionId ?? "pending"}</span>
                  {connectionLabel() && (
                    <span>Server · {connectionLabel()}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          {cell.branchName || cell.baseCommit ? (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]">
                Git Info
              </h3>
              <div className="rounded border border-border bg-muted/10 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">Branch</p>
                  <p className="break-all font-mono text-foreground">
                    {cell.branchName ?? "—"}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">Base Commit</p>
                  <p className="break-all font-mono text-foreground">
                    {cell.baseCommit ?? "—"}
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
