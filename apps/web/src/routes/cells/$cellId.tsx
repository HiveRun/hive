import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Cell, cellQueries } from "@/queries/cells";
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
  const activeRouteId = useRouterState({
    select: (state) => state.matches.at(-1)?.routeId,
  });

  const cell = cellQuery.data;
  const templates = templatesQuery.data?.templates ?? [];

  const templateLabel = templates.find(
    (template) => template.id === cell?.templateId
  )?.label;
  const navItems = [
    {
      routeId: "/cells/$cellId/services",
      label: "Services",
      to: "/cells/$cellId/services",
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-semibold text-2xl text-foreground tracking-wide">
                  {cell.name}
                </h1>
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
                  {cell.id}
                </span>
              </div>
              {cell.description ? (
                <p className="max-w-3xl text-muted-foreground text-sm">
                  {cell.description}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
                <span>Template · {templateLabel ?? cell.templateId}</span>
                <span>Workspace · {cell.workspacePath}</span>
              </div>
            </div>
            <OpencodeCommandPanel cell={cell} />
          </div>
        </section>

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
      </div>
    </div>
  );
}

function OpencodeCommandPanel({ cell }: { cell: Cell }) {
  const command = buildOpencodeCommand(cell);
  const hasSession = Boolean(cell.opencodeSessionId);
  const connectionLabel = describeServerConnection(cell);

  const handleCopy = async () => {
    if (!command) {
      toast.error("OpenCode session is not available yet");
      return;
    }

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(command);
      toast.success("OpenCode command copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy OpenCode command");
    }
  };

  return (
    <div className="space-y-2 rounded-sm border border-border/70 bg-background/70 p-3 text-foreground text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-[11px] uppercase tracking-[0.3em]">
            OpenCode CLI
          </p>
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
            {hasSession
              ? "Copy command to resume this cell in TUI"
              : "Start the agent to generate a session"}
          </p>
        </div>
        <Button
          className="shrink-0"
          data-testid="copy-opencode-command"
          disabled={!command}
          onClick={handleCopy}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy command
        </Button>
      </div>
      <pre className="min-h-[2.5rem] overflow-x-auto whitespace-pre-wrap break-all rounded border border-border/40 bg-card/70 p-2 font-mono text-[12px] text-foreground leading-relaxed">
        {command ?? "OpenCode session not available yet"}
      </pre>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
        <span>Session · {cell.opencodeSessionId ?? "pending"}</span>
        {connectionLabel ? <span>Server · {connectionLabel}</span> : null}
      </div>
    </div>
  );
}

function buildOpencodeCommand(cell: Cell): string | null {
  if (!cell.opencodeSessionId) {
    return null;
  }

  const args = [
    "opencode",
    shellQuote(cell.workspacePath),
    "--session",
    shellQuote(cell.opencodeSessionId),
  ];

  const { hostname, port } = deriveServerOptions(cell);
  if (hostname) {
    args.push("--hostname", shellQuote(hostname));
  }
  if (port) {
    args.push("--port", shellQuote(port));
  }

  return args.join(" ");
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
      // ignore invalid URL values; Hive can still provide the port separately
    }
  }

  if (cell.opencodeServerPort) {
    options.port = String(cell.opencodeServerPort);
  }

  return options;
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}
