import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Circle, CircleX, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { CellTerminal } from "@/components/cell-terminal";
import { useTheme } from "@/components/theme-provider";
import { cellQueries } from "@/queries/cells";

const PROVISIONING_POLL_MS = 1500;

type ChecklistStepKey =
  | "create_worktree"
  | "ensure_services"
  | "ensure_agent_session"
  | "mark_ready";

type ChecklistStepState = "done" | "active" | "pending" | "error";

type ProvisioningChecklistStep = {
  key: ChecklistStepKey;
  label: string;
  state: ChecklistStepState;
  durationMs?: number;
};

const CHECKLIST_STEPS: Array<{ key: ChecklistStepKey; label: string }> = [
  { key: "create_worktree", label: "Create workspace" },
  { key: "ensure_services", label: "Run setup and start services" },
  { key: "ensure_agent_session", label: "Prepare agent session" },
  { key: "mark_ready", label: "Finalize startup" },
];

export const Route = createFileRoute("/cells/$cellId/chat")({
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery({
    ...cellQueries.detail(cellId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "spawning" || status === "pending"
        ? PROVISIONING_POLL_MS
        : false;
    },
  });
  const { theme } = useTheme();
  const themeMode =
    theme === "light" ||
    (theme === "system" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light"))
      ? "light"
      : "dark";
  let startupStatusMessage = "Starting OpenCode session";
  if (cellQuery.data?.status === "spawning") {
    startupStatusMessage = "Provisioning workspace and services";
  } else if (cellQuery.data?.status === "pending") {
    startupStatusMessage = "Preparing agent session";
  }

  const isProvisioning =
    cellQuery.data?.status === "spawning" ||
    cellQuery.data?.status === "pending";
  const timingsQuery = useQuery({
    ...cellQueries.timings(cellId, { workflow: "create", limit: 300 }),
    enabled: isProvisioning,
    refetchInterval: isProvisioning ? PROVISIONING_POLL_MS : false,
  });

  const activeRunId = timingsQuery.data?.runs[0]?.runId;
  const activeRunSteps = useMemo(() => {
    if (!activeRunId) {
      return [];
    }

    return (timingsQuery.data?.steps ?? []).filter(
      (step) => step.runId === activeRunId
    );
  }, [activeRunId, timingsQuery.data?.steps]);

  const checklist = useMemo(
    () =>
      buildProvisioningChecklist({
        cellStatus: cellQuery.data?.status,
        steps: activeRunSteps,
      }),
    [cellQuery.data?.status, activeRunSteps]
  );

  const startupOverlay = isProvisioning ? (
    <ProvisioningChecklistOverlay
      checklist={checklist.steps}
      currentStep={checklist.currentStep}
      statusMessage={startupStatusMessage}
    />
  ) : null;

  return (
    <CellTerminal
      cellId={cellId}
      connectCommand={cellQuery.data?.opencodeCommand ?? null}
      endpointBase="chat/terminal"
      reconnectLabel="Reconnect chat"
      restartLabel="Restart chat"
      startupOverlay={startupOverlay}
      startupReadiness="terminal-content"
      startupStatusMessage={startupStatusMessage}
      startupTextMatch={cellQuery.data?.name ?? null}
      terminalLineHeight={1}
      themeMode={themeMode}
      title="Cell Chat"
    />
  );
}

function ProvisioningChecklistOverlay({
  statusMessage,
  checklist,
  currentStep,
}: {
  statusMessage: string;
  checklist: ProvisioningChecklistStep[];
  currentStep: string | null;
}) {
  return (
    <div className="w-[min(560px,92%)] border-2 border-border bg-card/95 px-4 py-3 shadow-[2px_2px_0_rgba(0,0,0,0.6)]">
      <p className="font-semibold text-[#FFC857] text-xs uppercase tracking-[0.24em]">
        Provisioning checklist
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
        {statusMessage}
      </p>
      <ol className="mt-3 space-y-2">
        {checklist.map((step) => (
          <li
            className="flex items-center justify-between gap-3 border border-border/60 bg-background/60 px-2.5 py-2"
            key={step.key}
          >
            <span className="flex items-center gap-2">
              <ChecklistIcon state={step.state} />
              <span className="text-[11px] text-foreground uppercase tracking-[0.18em]">
                {step.label}
              </span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
              {formatChecklistDuration(step)}
            </span>
          </li>
        ))}
      </ol>
      {currentStep ? (
        <p className="mt-3 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Current: {currentStep}
        </p>
      ) : null}
    </div>
  );
}

function formatChecklistDuration(step: ProvisioningChecklistStep): string {
  if (step.durationMs != null) {
    return `${Math.max(0, Math.round(step.durationMs))}ms`;
  }

  if (step.state === "active") {
    return "in progress";
  }

  return "-";
}

function ChecklistIcon({ state }: { state: ChecklistStepState }) {
  if (state === "done") {
    return <Check className="size-4 text-emerald-500" />;
  }

  if (state === "active") {
    return <Loader2 className="size-4 animate-spin text-primary" />;
  }

  if (state === "error") {
    return <CircleX className="size-4 text-destructive" />;
  }

  return <Circle className="size-4 text-muted-foreground" />;
}

function buildProvisioningChecklist(args: {
  cellStatus: string | undefined;
  steps: Array<{
    step: string;
    status: "ok" | "error";
    durationMs: number;
    createdAt: string;
  }>;
}): {
  steps: ProvisioningChecklistStep[];
  currentStep: string | null;
} {
  const sortedSteps = [...args.steps].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );

  const exactStepByName = new Map<string, (typeof sortedSteps)[number]>();
  for (const step of sortedSteps) {
    exactStepByName.set(step.step, step);
  }

  const latestActionStep = [...sortedSteps]
    .reverse()
    .find(
      (step) => step.step !== "total" && step.step !== "create_request_received"
    );
  const currentKey = latestActionStep
    ? normalizeChecklistStepKey(latestActionStep.step)
    : null;
  const errorKey =
    latestActionStep?.status === "error" && currentKey ? currentKey : null;

  const isDone = (key: ChecklistStepKey) => {
    if (key === "mark_ready") {
      return (
        args.cellStatus === "ready" ||
        exactStepByName.get("mark_ready")?.status === "ok"
      );
    }

    const exact = exactStepByName.get(key);
    return exact?.status === "ok";
  };

  const checklist = CHECKLIST_STEPS.map((definition) => {
    let state: ChecklistStepState = "pending";
    if (errorKey === definition.key) {
      state = "error";
    } else if (isDone(definition.key)) {
      state = "done";
    } else if (currentKey === definition.key) {
      state = "active";
    }

    return {
      key: definition.key,
      label: definition.label,
      state,
      durationMs: exactStepByName.get(definition.key)?.durationMs,
    } satisfies ProvisioningChecklistStep;
  });

  return {
    steps: checklist,
    currentStep: latestActionStep
      ? formatStepName(latestActionStep.step)
      : null,
  };
}

function normalizeChecklistStepKey(step: string): ChecklistStepKey | null {
  if (step.startsWith("create_worktree")) {
    return "create_worktree";
  }
  if (step.startsWith("ensure_services")) {
    return "ensure_services";
  }
  if (step === "ensure_agent_session" || step === "send_initial_prompt") {
    return "ensure_agent_session";
  }
  if (step === "mark_ready") {
    return "mark_ready";
  }
  return null;
}

function formatStepName(step: string): string {
  return step
    .replaceAll(":", " > ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}
