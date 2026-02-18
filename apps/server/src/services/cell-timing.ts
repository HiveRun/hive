import type {
  CellTimingStatus,
  CellTimingWorkflow,
} from "../schema/timing-events";

export const DEFAULT_TIMING_LIMIT = 200;
export const MAX_TIMING_LIMIT = 1000;

export type CellTimingStepRecord = {
  id: string;
  cellId: string;
  cellName: string | null;
  workspaceId: string | null;
  templateId: string | null;
  runId: string;
  workflow: CellTimingWorkflow;
  step: string;
  status: CellTimingStatus;
  durationMs: number;
  attempt: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CellTimingRunRecord = {
  runId: string;
  cellId: string;
  cellName: string | null;
  workspaceId: string | null;
  templateId: string | null;
  workflow: CellTimingWorkflow;
  status: CellTimingStatus;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stepCount: number;
  attempt: number | null;
};

type CellTimingEventRow = {
  id: string;
  cellId: string;
  cellName: string | null;
  workspaceId: string | null;
  templateId: string | null;
  runId: string;
  workflow: string;
  step: string;
  status: CellTimingStatus;
  durationMs: number;
  attempt: number | null;
  error: string | null;
  metadata: unknown;
  createdAt: Date;
};

export function normalizeTimingLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_TIMING_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_TIMING_LIMIT);
}

export function normalizeTimingWorkflow(
  value?: "create" | "delete" | "all"
): CellTimingWorkflow | null {
  if (value === "create" || value === "delete") {
    return value;
  }

  return null;
}

export function parseTimingStep(
  row: CellTimingEventRow
): CellTimingStepRecord | null {
  const workflow =
    row.workflow === "create" || row.workflow === "delete"
      ? row.workflow
      : null;

  if (!workflow) {
    return null;
  }

  return {
    id: row.id,
    cellId: row.cellId,
    cellName: row.cellName,
    workspaceId: row.workspaceId,
    templateId: row.templateId,
    runId: row.runId,
    workflow,
    step: row.step,
    status: row.status,
    durationMs: parseTimingDuration(row.durationMs),
    attempt: parseTimingAttempt(row.attempt),
    error: row.error,
    metadata: normalizeTimingMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildTimingRuns(
  steps: CellTimingStepRecord[]
): CellTimingRunRecord[] {
  const byRun = new Map<string, CellTimingStepRecord[]>();

  for (const step of steps) {
    const runSteps = byRun.get(step.runId) ?? [];
    runSteps.push(step);
    byRun.set(step.runId, runSteps);
  }

  const runs: CellTimingRunRecord[] = [];

  for (const [runId, runSteps] of byRun.entries()) {
    const ordered = [...runSteps].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!(first && last)) {
      continue;
    }

    const totalStep = ordered.find((step) => step.step === "total");
    const totalDurationMs = totalStep
      ? totalStep.durationMs
      : ordered.reduce((sum, step) => sum + step.durationMs, 0);
    const status = ordered.some((step) => step.status === "error")
      ? "error"
      : "ok";

    runs.push({
      runId,
      cellId: first.cellId,
      cellName: first.cellName,
      workspaceId: first.workspaceId,
      templateId: first.templateId,
      workflow: first.workflow,
      status,
      startedAt: first.createdAt,
      finishedAt: last.createdAt,
      totalDurationMs,
      stepCount: ordered.length,
      attempt: ordered.find((step) => step.attempt != null)?.attempt ?? null,
    });
  }

  return runs.sort((left, right) =>
    right.finishedAt.localeCompare(left.finishedAt)
  );
}

function normalizeTimingMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object") {
    return metadata as Record<string, unknown>;
  }

  return {};
}

function parseTimingDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function parseTimingAttempt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}
