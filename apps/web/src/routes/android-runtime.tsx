import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  Box,
  Bug,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleCheckBig,
  Compass,
  Cpu,
  Database,
  Gauge,
  Monitor,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  startTransition,
  useEffect,
  useState,
} from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  clampRuntimeStep,
  DEFAULT_RUNTIME_SCENARIO_ID,
  getRuntimeNodeStates,
  getRuntimeScenario,
  getRuntimeStep,
  isRuntimeFaultActive,
  RUNTIME_EDGES,
  RUNTIME_NODES,
  RUNTIME_SCENARIOS,
  type RuntimeEdge,
  type RuntimeEdgeId,
  type RuntimeLabNodeState,
  type RuntimeNodeId,
  type RuntimeScenario,
  type RuntimeScenarioId,
} from "@/lib/android-runtime-lab";
import { cn } from "@/lib/utils";

export const runtimeSearchSchema = z.object({
  fault: z.boolean().optional(),
  scenario: z
    .enum([
      "adb-isolation",
      "cold-start",
      "microphone",
      "stale-recovery",
      "viewer-restart",
    ])
    .optional(),
  returnStep: z.number().int().nonnegative().optional(),
  step: z.number().int().nonnegative().optional(),
  tour: z.enum(["explore", "guided"]).optional(),
});

type RuntimeSearch = z.infer<typeof runtimeSearchSchema>;
type RuntimeIcon = ComponentType<SVGProps<SVGSVGElement>>;

const PLAYBACK_INTERVAL_MS = 1800;
const RECIPROCAL_EDGE_OFFSET = 0.8;
const ACTIVE_EDGE_STROKE_WIDTH = 0.8;
const IDLE_EDGE_STROKE_WIDTH = 0.35;
const PERCENT_SCALE = 100;
const RUNTIME_NODE_BY_ID = new Map(
  RUNTIME_NODES.map((node) => [node.id, node])
);

type RuntimeSceneProps = {
  faultEnabled: boolean;
  scenario: RuntimeScenario;
  stepIndex: number;
};

type StepControlProps = {
  onSelect: (step: number) => void;
  scenario: RuntimeScenario;
  stepIndex: number;
};

type InteractiveRuntimeSceneProps = RuntimeSceneProps & {
  onStepSelect: (step: number) => void;
  selectedNodeId: RuntimeNodeId | null;
};

const getRuntimeSceneState = (
  scenario: RuntimeScenario,
  stepIndex: number,
  faultEnabled: boolean
) => ({
  faultActive: isRuntimeFaultActive(scenario, stepIndex, faultEnabled),
  step: getRuntimeStep(scenario, stepIndex),
});

const NODE_ICONS: Record<RuntimeNodeId, RuntimeIcon> = {
  browser: Monitor,
  emulator: Smartphone,
  grpc: RadioTower,
  guardian: ShieldCheck,
  guest: Box,
  lease: Database,
  product: Terminal,
  supervisor: Server,
  viewer: Cpu,
};

const STATE_LABELS: Record<RuntimeLabNodeState, string> = {
  active: "active",
  failed: "blocked",
  guarded: "guarded",
  idle: "standby",
  stopped: "stopped",
  verified: "verified",
  waiting: "waiting",
};

const NODE_STATE_CLASSES: Record<RuntimeLabNodeState, string> = {
  active:
    "border-primary bg-primary text-primary-foreground shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_20%,transparent),4px_4px_0_rgba(0,0,0,0.45)]",
  failed:
    "border-destructive bg-destructive/15 text-destructive shadow-[4px_4px_0_color-mix(in_oklch,var(--color-destructive)_35%,transparent)]",
  guarded:
    "border-violet-500 bg-violet-500/15 text-violet-300 shadow-[4px_4px_0_rgba(60,30,110,0.4)]",
  idle: "border-border bg-card/95 text-muted-foreground",
  stopped: "border-border bg-muted/80 text-muted-foreground opacity-65",
  verified:
    "border-teal-500 bg-teal-500/15 text-teal-300 shadow-[4px_4px_0_rgba(15,90,85,0.35)]",
  waiting:
    "border-primary bg-primary/10 text-primary shadow-[4px_4px_0_rgba(120,75,10,0.35)]",
};

export const Route = createFileRoute("/android-runtime")({
  validateSearch: (search) => runtimeSearchSchema.parse(search),
  component: AndroidRuntimeRoute,
});

export function AndroidRuntimeRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const scenario = getRuntimeScenario(
    search.scenario ?? DEFAULT_RUNTIME_SCENARIO_ID
  );
  const faultEnabled = search.fault ?? false;
  const stepIndex = faultEnabled
    ? scenario.fault.step
    : clampRuntimeStep(scenario, search.step ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<RuntimeNodeId | null>(
    null
  );
  const tourMode = search.tour;

  const updateSearch = (next: RuntimeSearch) =>
    navigate({ search: next, to: "/android-runtime" });

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    if (stepIndex >= scenario.steps.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(() => {
        navigate({
          replace: true,
          search: {
            fault: faultEnabled || undefined,
            scenario: scenario.id,
            step: stepIndex + 1,
            tour: tourMode,
          },
          to: "/android-runtime",
        });
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [faultEnabled, isPlaying, navigate, scenario, stepIndex, tourMode]);

  if (!tourMode) {
    return (
      <RuntimeBriefing
        onExplore={() =>
          updateSearch({
            scenario: DEFAULT_RUNTIME_SCENARIO_ID,
            step: 0,
            tour: "explore",
          })
        }
        onStart={() =>
          updateSearch({
            scenario: DEFAULT_RUNTIME_SCENARIO_ID,
            step: 0,
            tour: "guided",
          })
        }
      />
    );
  }

  const setScenario = (scenarioId: RuntimeScenarioId) => {
    setIsPlaying(false);
    setSelectedNodeId(null);
    updateSearch({ scenario: scenarioId, step: 0, tour: tourMode });
  };
  const setStep = (step: number) => {
    setIsPlaying(false);
    updateSearch({
      scenario: scenario.id,
      step,
      tour: tourMode,
    });
  };
  const toggleFault = () => {
    setIsPlaying(false);
    const returnStep = search.returnStep ?? stepIndex;
    updateSearch({
      fault: faultEnabled ? undefined : true,
      returnStep: faultEnabled ? undefined : returnStep,
      scenario: scenario.id,
      step: faultEnabled ? returnStep : scenario.fault.step,
      tour: tourMode,
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background/55">
      <RuntimeLabHeader
        faultEnabled={faultEnabled}
        isPlaying={isPlaying}
        onFaultToggle={toggleFault}
        onGuideStart={() =>
          updateSearch({
            scenario: DEFAULT_RUNTIME_SCENARIO_ID,
            step: 0,
            tour: "guided",
          })
        }
        onPlayToggle={() => setIsPlaying((value) => !value)}
        onReset={() => {
          setIsPlaying(false);
          setSelectedNodeId(null);
          updateSearch({ scenario: scenario.id, step: 0, tour: tourMode });
        }}
        scenario={scenario}
        stepIndex={stepIndex}
        tourMode={tourMode}
      />

      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        data-testid="runtime-lab-scroll"
      >
        {tourMode === "guided" ? (
          <RuntimeGuide
            faultEnabled={faultEnabled}
            onExit={() =>
              updateSearch({
                scenario: scenario.id,
                step: stepIndex,
                tour: "explore",
              })
            }
            onFaultToggle={toggleFault}
            onMove={(scenarioId, step) => {
              setIsPlaying(false);
              setSelectedNodeId(null);
              updateSearch({ scenario: scenarioId, step, tour: "guided" });
            }}
            onRestart={() =>
              updateSearch({
                scenario: DEFAULT_RUNTIME_SCENARIO_ID,
                step: 0,
                tour: "guided",
              })
            }
            scenario={scenario}
            stepIndex={stepIndex}
          />
        ) : null}
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[14rem_minmax(0,1fr)_20rem]"
          data-testid="runtime-lab-layout"
        >
          <ScenarioRail activeScenarioId={scenario.id} onSelect={setScenario} />
          <RuntimeWorkbench
            faultEnabled={faultEnabled}
            onNodeSelect={setSelectedNodeId}
            onStepSelect={setStep}
            scenario={scenario}
            selectedNodeId={selectedNodeId}
            stepIndex={stepIndex}
          />
          <RuntimeInspector
            faultEnabled={faultEnabled}
            onNodeClear={() => setSelectedNodeId(null)}
            onStepSelect={setStep}
            scenario={scenario}
            selectedNodeId={selectedNodeId}
            stepIndex={stepIndex}
          />
        </div>
      </div>
    </section>
  );
}

function RuntimeBriefing({
  onExplore,
  onStart,
}: {
  onExplore: () => void;
  onStart: () => void;
}) {
  const lessons = [
    {
      icon: Waypoints,
      label: "Lifecycle",
      text: "Follow ownership from port allocation through an identity-verified viewer.",
    },
    {
      icon: RadioTower,
      label: "Media",
      text: "Trace microphone audio from browser permission to Android AudioRecord.",
    },
    {
      icon: ShieldCheck,
      label: "Recovery",
      text: "See how Hive restarts, recovers stale resources, and blocks ADB escapes.",
    },
  ] as const;

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-4 sm:p-6 lg:p-8"
      data-testid="runtime-briefing"
    >
      <div className="mx-auto max-w-6xl border-2 border-border bg-card/70 shadow-[8px_8px_0_rgba(0,0,0,0.4)]">
        <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <div className="border-border border-b-2 p-5 sm:p-8 lg:border-r-2 lg:border-b-0 lg:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[10px] text-primary uppercase tracking-[0.32em]">
                Mission briefing
              </span>
              <span className="border border-border px-2 py-1 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.2em]">
                simulated · no host resources
              </span>
            </div>
            <h1 className="mt-5 max-w-3xl font-semibold text-3xl uppercase leading-tight tracking-[0.08em] sm:text-5xl">
              Understand the Android runtime by watching it move
            </h1>
            <p className="mt-5 max-w-2xl text-muted-foreground text-sm leading-relaxed sm:text-base">
              This lab is an interactive explanation of how Hive owns an Android
              emulator, connects the browser, carries audio, survives restarts,
              and prevents one cell from reaching another. Nothing here starts a
              real emulator or accesses your microphone.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {lessons.map(({ icon: Icon, label, text }, index) => (
                <div
                  className="border-2 border-border bg-background/45 p-4"
                  key={label}
                >
                  <div className="flex items-center justify-between text-primary">
                    <Icon className="size-4" />
                    <span className="font-mono text-[9px] tracking-[0.2em]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h2 className="mt-4 font-semibold text-xs uppercase tracking-[0.1em]">
                    {label}
                  </h2>
                  <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                    {text}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                onClick={onStart}
                size="lg"
                type="button"
              >
                <Play className="size-4" />
                Start guided tour
              </Button>
              <Button
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                onClick={onExplore}
                size="lg"
                type="button"
                variant="outline"
              >
                <Compass className="size-4" />
                Explore freely
              </Button>
            </div>
          </div>

          <aside className="bg-background/35 p-5 sm:p-8">
            <div className="flex items-center gap-2 text-primary">
              <BookOpen className="size-4" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
                How the tour works
              </span>
            </div>
            <ol className="mt-5 space-y-3">
              <li className="border-border border-l-2 pl-4">
                <strong className="block text-xs uppercase tracking-[0.08em]">
                  Read the checkpoint
                </strong>
                <span className="mt-1 block text-[11px] text-muted-foreground leading-relaxed">
                  The guide tells you what changed and which components to
                  watch.
                </span>
              </li>
              <li className="border-border border-l-2 pl-4">
                <strong className="block text-xs uppercase tracking-[0.08em]">
                  Inspect the signal bench
                </strong>
                <span className="mt-1 block text-[11px] text-muted-foreground leading-relaxed">
                  Bright nodes are acting now. Teal nodes have been verified.
                </span>
              </li>
              <li className="border-border border-l-2 pl-4">
                <strong className="block text-xs uppercase tracking-[0.08em]">
                  Advance when ready
                </strong>
                <span className="mt-1 block text-[11px] text-muted-foreground leading-relaxed">
                  Next checkpoint carries you through all five scenarios in
                  order.
                </span>
              </li>
            </ol>

            <div className="mt-7 border-2 border-primary/60 bg-primary/10 p-4">
              <p className="font-mono text-[9px] text-primary uppercase tracking-[0.22em]">
                Recommended
              </p>
              <p className="mt-2 text-xs leading-relaxed">
                Start with the guided tour. Use free exploration afterward to
                inject faults or revisit a specific subsystem.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function RuntimeGuide({
  faultEnabled,
  onExit,
  onFaultToggle,
  onMove,
  onRestart,
  scenario,
  stepIndex,
}: {
  faultEnabled: boolean;
  onExit: () => void;
  onFaultToggle: () => void;
  onMove: (scenarioId: RuntimeScenarioId, step: number) => void;
  onRestart: () => void;
  scenario: RuntimeScenario;
  stepIndex: number;
}) {
  const scenarioIndex = RUNTIME_SCENARIOS.findIndex(
    (candidate) => candidate.id === scenario.id
  );
  const completedBefore = RUNTIME_SCENARIOS.slice(0, scenarioIndex).reduce(
    (total, candidate) => total + candidate.steps.length,
    0
  );
  const totalSteps = RUNTIME_SCENARIOS.reduce(
    (total, candidate) => total + candidate.steps.length,
    0
  );
  const guideIndex = completedBefore + stepIndex;
  const isFirst = guideIndex === 0;
  const isLast = guideIndex === totalSteps - 1;
  const step = getRuntimeStep(scenario, stepIndex);
  const watchedNodeIds = faultEnabled
    ? (Object.keys(scenario.fault.nodeStates) as RuntimeNodeId[])
    : step.activeNodes;
  const watchedNodes = watchedNodeIds
    .map((nodeId) => RUNTIME_NODE_BY_ID.get(nodeId)?.shortLabel)
    .filter((label): label is string => Boolean(label));
  const guideTitle = faultEnabled
    ? `Failure branch: ${scenario.fault.title}`
    : `${isLast ? "Tour complete: " : "Watch now: "}${step.title}`;
  let guideDetail = step.detail;
  if (isLast) {
    guideDetail = `${step.detail} You have now followed all five scenarios and ${totalSteps} checkpoints.`;
  }
  if (faultEnabled) {
    guideDetail = scenario.fault.detail;
  }

  const move = (direction: -1 | 1) => {
    const targetStep = stepIndex + direction;
    if (targetStep >= 0 && targetStep < scenario.steps.length) {
      onMove(scenario.id, targetStep);
      return;
    }
    const targetScenario = RUNTIME_SCENARIOS[scenarioIndex + direction];
    if (!targetScenario) {
      return;
    }
    onMove(
      targetScenario.id,
      direction === 1 ? 0 : targetScenario.steps.length - 1
    );
  };

  return (
    <section
      aria-label="Guided tour checkpoint"
      className="sticky top-0 z-30 border-primary border-b-2 bg-background/95 p-3 shadow-[0_4px_0_rgba(0,0,0,0.35)] sm:p-4"
      data-testid="runtime-guide"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[9px] text-primary uppercase tracking-[0.24em]">
              Guided tour · Checkpoint {guideIndex + 1} of {totalSteps}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.18em]">
              Scenario {scenarioIndex + 1} of {RUNTIME_SCENARIOS.length} ·{" "}
              {scenario.title}
            </span>
          </div>
          <div
            aria-atomic="true"
            aria-live="polite"
            className="mt-2 flex items-start gap-3"
          >
            <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-semibold text-sm uppercase tracking-[0.08em]">
                {isLast && !faultEnabled ? (
                  <CircleCheckBig className="size-4 shrink-0 text-teal-400" />
                ) : null}
                {guideTitle}
              </h2>
              <p className="mt-1 max-w-4xl text-muted-foreground text-xs leading-relaxed">
                {guideDetail}
              </p>
              <p className="mt-2 font-mono text-[9px] text-primary uppercase tracking-[0.16em]">
                Focus nodes · {watchedNodes.join(" / ") || "system-wide"}
              </p>
            </div>
          </div>
          <div
            aria-label="Guided tour progress"
            aria-valuemax={totalSteps}
            aria-valuemin={1}
            aria-valuenow={guideIndex + 1}
            className="mt-3 h-1 bg-border/70"
            role="progressbar"
          >
            <div
              className="h-full bg-primary transition-[width] duration-150 ease-linear"
              style={{
                width: `${((guideIndex + 1) / totalSteps) * PERCENT_SCALE}%`,
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:max-w-[25rem] lg:justify-end">
          <Button
            className="rounded-none border-2 uppercase tracking-[0.1em]"
            disabled={isFirst || faultEnabled}
            onClick={() => move(-1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="size-3.5" />
            Back
          </Button>
          {isLast ? (
            <Button
              className="rounded-none border-2 uppercase tracking-[0.1em]"
              disabled={faultEnabled}
              onClick={onRestart}
              size="sm"
              type="button"
            >
              <RotateCcw className="size-3.5" />
              Review from start
            </Button>
          ) : (
            <Button
              className="rounded-none border-2 uppercase tracking-[0.1em]"
              disabled={faultEnabled}
              onClick={() => move(1)}
              size="sm"
              type="button"
            >
              Next checkpoint
              <ChevronRight className="size-3.5" />
            </Button>
          )}
          <Button
            aria-pressed={faultEnabled}
            className="rounded-none border-2 uppercase tracking-[0.1em]"
            onClick={onFaultToggle}
            size="sm"
            type="button"
            variant="outline"
          >
            <Bug className="size-3.5" />
            {faultEnabled ? "Return to path" : "Show failure"}
          </Button>
          <Button
            className="rounded-none border-2 uppercase tracking-[0.1em]"
            onClick={onExit}
            size="sm"
            type="button"
            variant="ghost"
          >
            Exit guide
          </Button>
        </div>
      </div>
    </section>
  );
}

function RuntimeLabHeader({
  faultEnabled,
  isPlaying,
  onFaultToggle,
  onGuideStart,
  onPlayToggle,
  onReset,
  scenario,
  stepIndex,
  tourMode,
}: {
  faultEnabled: boolean;
  isPlaying: boolean;
  onFaultToggle: () => void;
  onGuideStart: () => void;
  onPlayToggle: () => void;
  onReset: () => void;
  scenario: RuntimeScenario;
  stepIndex: number;
  tourMode: "explore" | "guided";
}) {
  return (
    <header className="relative z-10 border-border border-b-2 bg-card/95 px-4 py-3 shadow-[0_4px_0_rgba(0,0,0,0.25)] sm:px-5 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 border-primary border-l-4 pl-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-mono text-[10px] text-primary uppercase tracking-[0.32em]">
              Simulated control surface
            </p>
            <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase tracking-[0.22em]">
              no host resources
            </span>
          </div>
          <h1 className="mt-1 font-semibold text-xl uppercase tracking-[0.08em] sm:text-2xl">
            Android Runtime Lab
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-xs sm:text-sm">
            {scenario.title} · Step {stepIndex + 1} of {scenario.steps.length} ·{" "}
            {scenario.summary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tourMode === "explore" ? (
            <>
              <Button
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                onClick={onGuideStart}
                size="sm"
                type="button"
                variant="outline"
              >
                <Compass className="size-3.5" />
                Start guide
              </Button>
              <Button
                aria-label={isPlaying ? "Pause scenario" : "Play scenario"}
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                disabled={
                  faultEnabled ||
                  (!isPlaying && stepIndex >= scenario.steps.length - 1)
                }
                onClick={onPlayToggle}
                size="sm"
                type="button"
                variant="outline"
              >
                {isPlaying ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {isPlaying ? "Pause" : "Play"}
              </Button>
              <Button
                aria-pressed={faultEnabled}
                className={cn(
                  "rounded-none border-2 uppercase tracking-[0.12em]",
                  faultEnabled &&
                    "border-destructive bg-destructive/15 text-destructive hover:bg-destructive/20"
                )}
                onClick={onFaultToggle}
                size="sm"
                type="button"
                variant="outline"
              >
                <Bug className="size-3.5" />
                {scenario.fault.label}
              </Button>
            </>
          ) : (
            <span className="border-2 border-primary bg-primary/10 px-3 py-1.5 font-mono text-[9px] text-primary uppercase tracking-[0.18em]">
              Guide active
            </span>
          )}
          <Button
            aria-label="Reset scenario"
            className="rounded-none border-2"
            onClick={onReset}
            size="icon-sm"
            title="Reset scenario"
            type="button"
            variant="outline"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function ScenarioRail({
  activeScenarioId,
  onSelect,
}: {
  activeScenarioId: RuntimeScenarioId;
  onSelect: (scenarioId: RuntimeScenarioId) => void;
}) {
  return (
    <nav
      aria-label="Runtime scenarios"
      className="min-w-0 border-border border-b-2 bg-card/35 p-3 lg:col-span-2 2xl:col-span-1 2xl:border-r-2 2xl:border-b-0"
      data-testid="runtime-scenario-rail"
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-1">
        {RUNTIME_SCENARIOS.map((scenario, index) => {
          const active = scenario.id === activeScenarioId;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={cn(
                "group min-w-0 border-2 p-3 text-left transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                index === RUNTIME_SCENARIOS.length - 1 &&
                  "col-span-2 sm:col-span-1",
                active
                  ? "border-primary bg-primary/10 shadow-[4px_4px_0_rgba(0,0,0,0.32)]"
                  : "border-border bg-card/80 hover:border-primary/60 hover:bg-primary/5"
              )}
              key={scenario.id}
              onClick={() => onSelect(scenario.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] text-primary uppercase tracking-[0.26em]">
                  {String(index + 1).padStart(2, "0")} · {scenario.shortLabel}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "size-2 border border-border",
                    active ? "bg-primary" : "bg-muted"
                  )}
                />
              </div>
              <span className="mt-2 block font-semibold text-xs uppercase tracking-[0.1em]">
                {scenario.title}
              </span>
              <span className="mt-1 hidden text-[11px] text-muted-foreground leading-relaxed 2xl:block">
                {scenario.summary}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 hidden border-border border-t pt-3 2xl:block">
        <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.24em]">
          Bench rule
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          Every scene is deterministic. Fault switches alter the model only; no
          emulator, process, port, or microphone is touched.
        </p>
      </div>
    </nav>
  );
}

function RuntimeWorkbench({
  faultEnabled,
  onNodeSelect,
  onStepSelect,
  scenario,
  selectedNodeId,
  stepIndex,
}: InteractiveRuntimeSceneProps & {
  onNodeSelect: (nodeId: RuntimeNodeId) => void;
}) {
  const { faultActive, step } = getRuntimeSceneState(
    scenario,
    stepIndex,
    faultEnabled
  );
  const nodeStates = getRuntimeNodeStates(scenario, stepIndex, faultEnabled);
  const activeEdges = new Set<RuntimeEdgeId>([
    ...step.activeEdges,
    ...(faultActive ? scenario.fault.activeEdges : []),
  ]);
  const blockedEdges = new Set<RuntimeEdgeId>(
    faultActive ? scenario.fault.blockedEdges : []
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col gap-3 p-3 sm:p-4 2xl:p-5"
      data-testid="runtime-workbench"
    >
      <div
        className="flex min-h-[32rem] flex-col overflow-hidden border-2 border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-card)_96%,transparent),color-mix(in_oklch,var(--color-background)_90%,transparent))] shadow-[6px_6px_0_rgba(0,0,0,0.38)] sm:min-h-[35rem] lg:min-h-[38rem]"
        data-testid="runtime-topology-panel"
      >
        <div className="z-20 flex shrink-0 items-center justify-between border-border border-b bg-card/90 px-3 py-2">
          <div className="flex items-center gap-2">
            <Gauge className="size-3.5 text-primary" />
            <span className="font-mono text-[9px] uppercase tracking-[0.24em]">
              Process topology
            </span>
          </div>
          <span
            className={cn(
              "font-mono text-[9px] uppercase tracking-[0.2em]",
              faultActive ? "text-destructive" : "text-teal-400"
            )}
          >
            {faultActive ? "fault injected" : "nominal model"}
          </span>
        </div>

        <div
          className="relative min-h-[22rem] flex-1 overflow-hidden"
          data-testid="runtime-topology-canvas"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,color-mix(in_oklch,var(--color-border)_65%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--color-border)_65%,transparent)_1px,transparent_1px)] [background-size:32px_32px]"
          />
          <TopologyEdges
            activeEdges={activeEdges}
            blockedEdges={blockedEdges}
          />

          {RUNTIME_NODES.map((node) => {
            const Icon = NODE_ICONS[node.id];
            const state = nodeStates[node.id];
            const selected = node.id === selectedNodeId;
            return (
              <button
                aria-label={`${node.label}, ${STATE_LABELS[state]}`}
                aria-pressed={selected}
                className={cn(
                  "-translate-x-1/2 -translate-y-1/2 absolute z-10 flex w-14 flex-col items-center border-2 px-1 py-1.5 text-center transition-[transform] duration-150 ease-linear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:w-[4.5rem] sm:px-2 sm:py-2 2xl:w-24",
                  NODE_STATE_CLASSES[state],
                  selected &&
                    "ring-2 ring-violet-500 ring-offset-2 ring-offset-background"
                )}
                key={node.id}
                onClick={() => onNodeSelect(node.id)}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                type="button"
              >
                <Icon aria-hidden className="size-4 sm:size-5" />
                <span className="mt-1 font-semibold text-[9px] uppercase tracking-[0.08em] sm:text-[10px]">
                  {node.shortLabel}
                </span>
                <span className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.12em] opacity-80 sm:text-[8px]">
                  {STATE_LABELS[state]}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="z-20 m-3 shrink-0 border-2 border-border bg-background/92 p-3 backdrop-blur-sm sm:m-4"
          data-testid="runtime-event-plaque"
        >
          <div className="flex items-start gap-3">
            {faultActive ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <RadioTower className="mt-0.5 size-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p
                aria-live="polite"
                className={cn(
                  "font-semibold text-xs uppercase tracking-[0.08em]",
                  faultActive && "text-destructive"
                )}
              >
                {faultActive ? scenario.fault.event : step.event}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed sm:text-xs">
                {faultActive ? scenario.fault.detail : step.detail}
              </p>
            </div>
          </div>
        </div>
      </div>

      <StepRail
        onSelect={onStepSelect}
        scenario={scenario}
        stepIndex={stepIndex}
      />
    </div>
  );
}

function TopologyEdges({
  activeEdges,
  blockedEdges,
}: {
  activeEdges: Set<RuntimeEdgeId>;
  blockedEdges: Set<RuntimeEdgeId>;
}) {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 size-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <title>Runtime topology connections</title>
      <defs>
        <marker
          id="runtime-arrow"
          markerHeight="5"
          markerWidth="5"
          orient="auto"
          refX="4"
          refY="2.5"
        >
          <path d="M0,0 L5,2.5 L0,5 z" fill="currentColor" />
        </marker>
      </defs>
      {RUNTIME_EDGES.map((edge, index) => (
        <TopologyEdge
          active={activeEdges.has(edge.id)}
          blocked={blockedEdges.has(edge.id)}
          edge={edge}
          index={index}
          key={edge.id}
        />
      ))}
    </svg>
  );
}

function TopologyEdge({
  active,
  blocked,
  edge,
  index,
}: {
  active: boolean;
  blocked: boolean;
  edge: RuntimeEdge;
  index: number;
}) {
  const from = RUNTIME_NODE_BY_ID.get(edge.from);
  const to = RUNTIME_NODE_BY_ID.get(edge.to);
  if (!(from && to)) {
    return null;
  }
  const emphasized = active || blocked;
  const reciprocalOffset =
    index % 2 === 0 ? -RECIPROCAL_EDGE_OFFSET : RECIPROCAL_EDGE_OFFSET;
  let strokeDasharray = "1.5 2.5";
  if (active) {
    strokeDasharray = "5 2";
  }
  if (blocked) {
    strokeDasharray = "2 2";
  }

  return (
    <line
      className={cn(
        "text-border transition-colors duration-150",
        active && "text-primary",
        blocked && "text-destructive"
      )}
      markerEnd={emphasized ? "url(#runtime-arrow)" : undefined}
      stroke="currentColor"
      strokeDasharray={strokeDasharray}
      strokeWidth={
        emphasized ? ACTIVE_EDGE_STROKE_WIDTH : IDLE_EDGE_STROKE_WIDTH
      }
      vectorEffect="non-scaling-stroke"
      x1={from.x + reciprocalOffset}
      x2={to.x + reciprocalOffset}
      y1={from.y}
      y2={to.y}
    />
  );
}

function StepRail({ onSelect, scenario, stepIndex }: StepControlProps) {
  return (
    <div className="border-2 border-border bg-card/75 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.24em]">
          Event rail
        </span>
        <span className="font-mono text-[9px] text-primary uppercase tracking-[0.2em]">
          {getRuntimeStep(scenario, stepIndex).title}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {scenario.steps.map((step, index) => {
          const active = index === stepIndex;
          const complete = index < stepIndex;
          return (
            <button
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative min-h-16 border-2 p-2 text-left transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background/40 hover:border-primary/60",
                complete && "border-teal-500/60"
              )}
              key={step.id}
              onClick={() => onSelect(index)}
              type="button"
            >
              <span
                className={cn(
                  "font-mono text-[8px] uppercase tracking-[0.2em]",
                  complete ? "text-teal-400" : "text-muted-foreground",
                  active && "text-primary"
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 block font-semibold text-[10px] uppercase leading-tight tracking-[0.06em]">
                {step.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeInspector({
  faultEnabled,
  onNodeClear,
  onStepSelect,
  scenario,
  selectedNodeId,
  stepIndex,
}: InteractiveRuntimeSceneProps & {
  onNodeClear: () => void;
}) {
  const { faultActive, step } = getRuntimeSceneState(
    scenario,
    stepIndex,
    faultEnabled
  );
  const selectedNode = RUNTIME_NODES.find((node) => node.id === selectedNodeId);
  const nodeState = selectedNode
    ? getRuntimeNodeStates(scenario, stepIndex, faultEnabled)[selectedNode.id]
    : null;
  let title = faultActive ? scenario.fault.title : step.title;
  let detail = faultActive ? scenario.fault.detail : step.detail;
  if (selectedNode) {
    title = selectedNode.label;
    detail = selectedNode.role;
  }
  const why = faultActive ? scenario.fault.why : step.why;
  const source = faultActive ? scenario.fault.source : step.source;

  return (
    <aside
      className="min-w-0 border-border border-t-2 bg-card/35 p-3 lg:border-t-0 lg:border-l-2 lg:p-4 2xl:p-4"
      data-testid="runtime-inspector"
    >
      <div className="space-y-3">
        <div className="border-2 border-border bg-card p-4 shadow-[4px_4px_0_rgba(0,0,0,0.3)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] text-primary uppercase tracking-[0.24em]">
                {selectedNode ? "Node inspection" : "Step inspection"}
              </p>
              <h2 className="mt-2 font-semibold text-sm uppercase tracking-[0.08em]">
                {title}
              </h2>
            </div>
            {selectedNode ? (
              <button
                className="border border-border px-2 py-1 font-mono text-[8px] text-muted-foreground uppercase tracking-[0.16em] hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                onClick={onNodeClear}
                type="button"
              >
                Step
              </button>
            ) : null}
          </div>
          {nodeState ? (
            <span className="mt-3 inline-flex border border-border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.18em]">
              state · {STATE_LABELS[nodeState]}
            </span>
          ) : null}
          <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
            {detail}
          </p>
        </div>

        <TelemetryPanel telemetry={step.telemetry} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <InspectorPanel icon={CircleCheck} label="Checks">
            <ul className="space-y-2">
              {step.checks.map((check) => (
                <li
                  className="flex gap-2 text-[11px] leading-relaxed"
                  key={check}
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 shrink-0 bg-teal-400"
                  />
                  {check}
                </li>
              ))}
            </ul>
          </InspectorPanel>

          <InspectorPanel icon={ShieldCheck} label="Why this exists">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {why}
            </p>
          </InspectorPanel>
        </div>

        <div className="border-2 border-border bg-background/45 p-3">
          <div className="flex items-center gap-2 text-primary">
            <Bot className="size-3.5" />
            <span className="font-mono text-[9px] uppercase tracking-[0.22em]">
              Source trace
            </span>
          </div>
          <code className="mt-2 block break-all border-border border-l-2 pl-2 font-mono text-[10px] text-muted-foreground leading-relaxed">
            {source}
          </code>
        </div>

        <StepNavigation
          onSelect={onStepSelect}
          scenario={scenario}
          stepIndex={stepIndex}
        />
      </div>
    </aside>
  );
}

function TelemetryPanel({
  telemetry,
}: {
  telemetry: RuntimeScenario["steps"][number]["telemetry"];
}) {
  const values = [
    ["Lease", telemetry.lease],
    ["Serial", telemetry.serial],
    ["gRPC", telemetry.grpc],
    ["Viewer", telemetry.viewer],
  ] as const;
  return (
    <div className="grid grid-cols-2 border-2 border-border bg-background/45">
      {values.map(([label, value], index) => (
        <div
          className={cn(
            "min-w-0 p-3",
            index % 2 === 0 && "border-border border-r",
            index < 2 && "border-border border-b"
          )}
          key={label}
        >
          <p className="font-mono text-[8px] text-muted-foreground uppercase tracking-[0.2em]">
            {label}
          </p>
          <p
            className="mt-1 truncate font-mono text-[10px] text-primary"
            title={value}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function InspectorPanel({
  children,
  icon: Icon,
  label,
}: {
  children: ReactNode;
  icon: RuntimeIcon;
  label: string;
}) {
  return (
    <div className="border-2 border-border bg-background/45 p-3">
      <div className="mb-3 flex items-center gap-2 text-primary">
        <Icon className="size-3.5" />
        <span className="font-mono text-[9px] uppercase tracking-[0.22em]">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function StepNavigation({ onSelect, scenario, stepIndex }: StepControlProps) {
  return (
    <div className="flex gap-2">
      <Button
        className="flex-1 rounded-none border-2 uppercase tracking-[0.12em]"
        disabled={stepIndex === 0}
        onClick={() => onSelect(stepIndex - 1)}
        size="sm"
        type="button"
        variant="outline"
      >
        <ChevronLeft className="size-3.5" />
        Previous
      </Button>
      <Button
        className="flex-1 rounded-none border-2 uppercase tracking-[0.12em]"
        disabled={stepIndex === scenario.steps.length - 1}
        onClick={() => onSelect(stepIndex + 1)}
        size="sm"
        type="button"
      >
        Next
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
