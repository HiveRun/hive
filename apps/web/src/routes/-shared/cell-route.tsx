import type { QueryClient } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildProvisioningChecklist } from "@/lib/provisioning-checklist";
import {
  type CellStatus,
  type CellTimingResponse,
  cellQueries,
} from "@/queries/cells";

export const ignoreRoutePromiseRejection = (_error: unknown) => null;

export function prefetchCellDetail(queryClient: QueryClient, cellId: string) {
  queryClient
    .prefetchQuery(cellQueries.detail(cellId))
    .catch(ignoreRoutePromiseRejection);
}

export function CellRouteMessage({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "destructive";
}) {
  const className =
    tone === "destructive"
      ? "flex h-full flex-1 items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive"
      : "flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground";

  return <div className={className}>{children}</div>;
}

export function CenteredCellLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 border-2 border-border/70 bg-muted/20 px-5 py-4">
          <Loader2 className="size-5 animate-spin text-primary" />
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CellDetailGate({
  children,
  errorFallback,
  query,
}: {
  children: ReactNode;
  errorFallback: string;
  query: { isLoading: boolean; error: unknown };
}) {
  if (query.isLoading) {
    return <CellRouteMessage>Loading cell…</CellRouteMessage>;
  }

  if (query.error) {
    const message =
      query.error instanceof Error ? query.error.message : errorFallback;
    return <CellRouteMessage tone="destructive">{message}</CellRouteMessage>;
  }

  return children;
}

export function useCreateProvisioningChecklist({
  cellStatus,
  timings,
}: {
  cellStatus?: CellStatus;
  timings?: CellTimingResponse;
}) {
  const activeRunId = timings?.runs[0]?.runId;
  const activeRunSteps = useMemo(() => {
    if (!activeRunId) {
      return [];
    }

    return (timings?.steps ?? []).filter((step) => step.runId === activeRunId);
  }, [activeRunId, timings?.steps]);

  return useMemo(
    () =>
      buildProvisioningChecklist({
        cellStatus,
        steps: activeRunSteps,
      }),
    [activeRunSteps, cellStatus]
  );
}

export async function copyCellRouteText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch (_error) {
    toast.error("Failed to copy to clipboard");
  }
}

export function CopyIconButton({
  label,
  text,
}: {
  label: string;
  text?: string | number | null;
}) {
  if (text == null || text === "") {
    return null;
  }

  return (
    <Button
      aria-label={`Copy ${label}`}
      className="h-5 w-5 shrink-0 p-0"
      onClick={() => copyCellRouteText(String(text))}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}

export function CopyableDetailLabel({
  children,
  copyLabel,
  copyText,
}: {
  children: ReactNode;
  copyLabel: string;
  copyText?: string | number | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
        {children}
      </p>
      <CopyIconButton label={copyLabel} text={copyText} />
    </div>
  );
}
