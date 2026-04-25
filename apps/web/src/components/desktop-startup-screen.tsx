import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RadioTower,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopStartupSnapshot } from "@/lib/desktop-startup";
import { cn } from "@/lib/utils";

type DesktopStartupScreenProps = {
  snapshot: DesktopStartupSnapshot;
  onRetry?: () => void;
};

const phases = [
  {
    phase: "starting-daemon",
    label: "Starting Daemon",
    description: "Igniting the local Hive process.",
    icon: Server,
  },
  {
    phase: "connecting",
    label: "Connecting To Hive",
    description: "Waiting for the API health signal.",
    icon: RadioTower,
  },
  {
    phase: "loading-workspaces",
    label: "Loading Workspaces",
    description: "Pulling registered workspace scaffolds.",
    icon: Database,
  },
  {
    phase: "ready",
    label: "Ready",
    description: "The swarm is online.",
    icon: CheckCircle2,
  },
] as const;

const phaseIndex = (phase: DesktopStartupSnapshot["phase"]) => {
  if (phase === "error") {
    return -1;
  }

  return phases.findIndex((entry) => entry.phase === phase);
};

export function DesktopStartupScreen({
  snapshot,
  onRetry,
}: DesktopStartupScreenProps) {
  const activeIndex = phaseIndex(snapshot.phase);
  const isError = snapshot.phase === "error";
  const title = isError ? "Hive Startup Interrupted" : snapshot.message;
  let detail = "Preparing desktop runtime.";
  if (isError) {
    detail = snapshot.error ?? "Hive did not become reachable.";
  } else if (snapshot.healthUrl) {
    detail = `Target: ${snapshot.healthUrl}`;
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-8 text-foreground"
      data-phase={snapshot.phase}
      data-testid="desktop-startup-screen"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(245,165,36,0.11)_0,transparent_34%),radial-gradient(circle_at_20%_20%,rgba(245,165,36,0.16),transparent_28%),radial-gradient(circle_at_78%_70%,rgba(45,212,191,0.1),transparent_32%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(30deg,currentColor_12%,transparent_12.5%,transparent_87%,currentColor_87.5%,currentColor),linear-gradient(150deg,currentColor_12%,transparent_12.5%,transparent_87%,currentColor_87.5%,currentColor),linear-gradient(30deg,currentColor_12%,transparent_12.5%,transparent_87%,currentColor_87.5%,currentColor),linear-gradient(150deg,currentColor_12%,transparent_12.5%,transparent_87%,currentColor_87.5%,currentColor)] [background-position:0_0,0_0,24px_42px,24px_42px] [background-size:48px_84px]"
      />
      <section className="relative w-full max-w-3xl border-4 border-border bg-card/95 shadow-[10px_10px_0_rgba(0,0,0,0.45),-2px_-2px_0_rgba(245,165,36,0.28)]">
        <div className="grid gap-0 md:grid-cols-[1fr_280px]">
          <div className="border-border border-b-4 p-6 md:border-r-4 md:border-b-0 md:p-8">
            <div className="mb-8 flex items-center gap-4">
              <div className="flex size-14 items-center justify-center border-4 border-primary bg-primary/10 text-primary shadow-[5px_5px_0_rgba(0,0,0,0.45)]">
                {isError ? (
                  <AlertTriangle className="size-7" />
                ) : (
                  <Loader2 className="size-7 animate-spin" />
                )}
              </div>
              <div>
                <p className="text-[0.62rem] text-muted-foreground uppercase tracking-[0.36em]">
                  Hive Desktop Startup
                </p>
                <h1
                  className="mt-2 font-semibold text-2xl uppercase tracking-[0.12em] md:text-3xl"
                  data-testid="desktop-startup-phase"
                >
                  {title}
                </h1>
              </div>
            </div>

            <p className="max-w-xl text-muted-foreground text-sm leading-6">
              The main window is live while Hive finishes cold-start work in the
              background. Routes stay gated here until the local API and
              workspace registry can answer reliably.
            </p>

            <div className="mt-8 border-2 border-border bg-background/60 p-4 font-mono text-[11px] text-muted-foreground">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <span>MODE: {snapshot.startupMode ?? "starting"}</span>
                <span>ATTEMPT: {snapshot.attempt}</span>
              </div>
              <div className="mt-2 break-all text-foreground/80">{detail}</div>
            </div>

            {isError && onRetry ? (
              <Button className="mt-6 rounded-none" onClick={onRetry}>
                Retry Connection
              </Button>
            ) : null}
          </div>

          <ol className="grid content-center gap-3 p-5 md:p-6">
            {phases.map((entry, index) => {
              const Icon = entry.icon;
              const isActive = index === activeIndex;
              const isComplete =
                activeIndex > index || snapshot.phase === "ready";

              return (
                <li
                  className={cn(
                    "border-2 border-border bg-background/60 p-3 transition-none",
                    isActive && "border-primary bg-primary/10 text-foreground",
                    isComplete && "border-primary/70 text-foreground"
                  )}
                  key={entry.phase}
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 text-muted-foreground",
                        (isActive || isComplete) && "text-primary"
                      )}
                    />
                    <div>
                      <div className="font-semibold text-[0.66rem] uppercase tracking-[0.22em]">
                        {entry.label}
                      </div>
                      <p className="mt-1 text-muted-foreground text-xs leading-5">
                        {entry.description}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </main>
  );
}
