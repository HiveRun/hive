import { Check, Circle, CircleX, Loader2 } from "lucide-react";
import type {
  ProvisioningChecklist,
  ProvisioningChecklistStep,
  ProvisioningChecklistStepState,
} from "@/lib/provisioning-checklist";
import { cn } from "@/lib/utils";

type ProvisioningChecklistPanelProps = {
  checklist: ProvisioningChecklist;
  statusMessage: string;
  variant?: "inline" | "overlay";
  className?: string;
  fillHeight?: boolean;
};

export function ProvisioningChecklistPanel({
  checklist,
  statusMessage,
  variant = "inline",
  className,
  fillHeight = false,
}: ProvisioningChecklistPanelProps) {
  const stepNumber =
    checklist.remainingCount === 0
      ? checklist.totalCount
      : Math.min(checklist.completedCount + 1, checklist.totalCount);
  const leftCount = checklist.remainingCount;
  const leftLabel = `${leftCount} step${leftCount === 1 ? "" : "s"} left`;

  return (
    <div
      className={cn(
        "border-2 border-border bg-card/95 px-4 py-3 shadow-[2px_2px_0_rgba(0,0,0,0.6)]",
        fillHeight && "flex h-full min-h-0 flex-col",
        variant === "overlay" ? "w-[min(620px,94%)]" : "mt-3 w-full",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-[#FFC857] text-xs uppercase tracking-[0.24em]">
          Provisioning timeline
        </p>
        <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Step {stepNumber}/{checklist.totalCount}
        </p>
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
        {statusMessage}
      </p>

      <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
        {checklist.completedCount}/{checklist.totalCount} complete - {leftLabel}
      </p>

      <ol
        className={cn(
          "mt-3 space-y-2",
          fillHeight && "min-h-0 flex-1 overflow-auto pr-1"
        )}
      >
        {checklist.steps.map((step, index) => (
          <li
            className={cn(
              "border px-2.5 py-2",
              step.state === "done" &&
                "border-emerald-500/50 bg-emerald-500/10",
              step.state === "active" && "border-primary/70 bg-primary/10",
              step.state === "error" &&
                "border-destructive/70 bg-destructive/10 text-destructive",
              step.state === "pending" &&
                "border-border/60 bg-background/60 text-foreground"
            )}
            key={step.key}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center border border-border/60 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
                  {index + 1}
                </span>
                <ChecklistIcon state={step.state} />
                <span className="text-[11px] uppercase tracking-[0.18em]">
                  {step.label}
                </span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
                {formatStepStatus(step)}
              </span>
            </div>
            {step.detail ? (
              <p className="mt-1 pl-[3.1rem] text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
                {step.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {checklist.currentStep ? (
        <p className="mt-3 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Current: {checklist.currentStep}
        </p>
      ) : null}
      {!checklist.hasError && checklist.nextStepLabel ? (
        <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Next: {checklist.nextStepLabel}
        </p>
      ) : null}
    </div>
  );
}

function ChecklistIcon({ state }: { state: ProvisioningChecklistStepState }) {
  if (state === "done") {
    return <Check className="size-4 text-emerald-400" />;
  }

  if (state === "active") {
    return <Loader2 className="size-4 animate-spin text-primary" />;
  }

  if (state === "error") {
    return <CircleX className="size-4 text-destructive" />;
  }

  return <Circle className="size-4 text-muted-foreground" />;
}

function formatStepStatus(step: ProvisioningChecklistStep): string {
  if (step.durationMs != null) {
    return `${Math.max(0, Math.round(step.durationMs))}ms`;
  }

  if (step.state === "active") {
    return "in progress";
  }

  if (step.state === "error") {
    return "failed";
  }

  if (step.state === "done") {
    return "done";
  }

  return "queued";
}
