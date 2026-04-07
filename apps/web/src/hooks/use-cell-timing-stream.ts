import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiBase } from "@/lib/api-base";
import { joinTimingRealtimeChannel } from "@/lib/realtime-channels";
import type {
  CellTimingResponse,
  CellTimingRun,
  CellTimingStatus,
  CellTimingStep,
  CellTimingWorkflow,
} from "@/queries/cells";

const API_BASE = getApiBase();

type TimingQueryKey = readonly [
  "cells",
  string,
  "timings",
  number | null,
  "all" | CellTimingWorkflow,
  string | null,
];

type CellTimingStreamOptions = {
  enabled?: boolean;
  workflow?: "all" | "create" | "delete";
};

export function useCellTimingStream(
  cellId: string,
  options: CellTimingStreamOptions = {}
) {
  const { enabled = true, workflow = "all" } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!(enabled && cellId) || typeof window === "undefined") {
      return;
    }

    const syncTimingStep = (step: CellTimingStep) => {
      for (const queryEntry of queryClient.getQueryCache().findAll({
        predicate: (queryRecord) =>
          isCellTimingQuery(queryRecord.queryKey, cellId),
      })) {
        queryClient.setQueryData<CellTimingResponse>(
          queryEntry.queryKey,
          (current) =>
            mergeTimingStep(
              current,
              queryEntry.queryKey as TimingQueryKey,
              step
            )
        );
      }
    };

    const timingListener = (payload: unknown) => {
      const step = payload as CellTimingStep;

      if (workflow !== "all" && step.workflow !== workflow) {
        return;
      }

      syncTimingStep(step);
    };

    const resyncSnapshot = () => {
      queryClient.invalidateQueries({
        predicate: (queryEntry) =>
          isCellTimingQuery(queryEntry.queryKey, cellId),
      });

      queryClient.invalidateQueries({
        queryKey: ["cells", "timings", "global"],
      });
    };

    const subscription = joinTimingRealtimeChannel({
      apiBase: API_BASE,
      cellId,
      handlers: {
        timing_snapshot: timingListener,
      },
      onJoin: resyncSnapshot,
      onError: () => {
        // Phoenix Socket will reconnect automatically; keep current data until rejoined.
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [cellId, enabled, queryClient, workflow]);
}

function isCellTimingQuery(
  queryKey: readonly unknown[],
  cellId: string
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === "cells" &&
    queryKey[1] === cellId &&
    queryKey[2] === "timings"
  );
}

function mergeTimingStep(
  current: CellTimingResponse | undefined,
  queryKey: TimingQueryKey,
  step: CellTimingStep
): CellTimingResponse | undefined {
  if (!current || step.cellId !== queryKey[1]) {
    return current;
  }

  const workflowFilter = queryKey[4];
  if (workflowFilter !== "all" && step.workflow !== workflowFilter) {
    return current;
  }

  const runIdFilter = queryKey[5];
  if (runIdFilter && step.runId !== runIdFilter) {
    return current;
  }

  const nextSteps = [...current.steps];
  const existingIndex = nextSteps.findIndex((entry) => entry.id === step.id);

  if (existingIndex === -1) {
    nextSteps.push(step);
  } else {
    nextSteps[existingIndex] = step;
  }

  nextSteps.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );

  const limit = typeof queryKey[3] === "number" ? queryKey[3] : null;
  const limitedSteps = limit ? nextSteps.slice(-limit) : nextSteps;

  return {
    steps: limitedSteps,
    runs: toTimingRuns(limitedSteps),
  };
}

function toTimingRuns(timings: CellTimingStep[]): CellTimingRun[] {
  return Array.from(
    timings.reduce((runs, timing) => {
      const entries = runs.get(timing.runId) ?? [];
      entries.push(timing);
      runs.set(timing.runId, entries);
      return runs;
    }, new Map<string, CellTimingStep[]>())
  )
    .map(([runId, runSteps]) => {
      const ordered = [...runSteps].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      );
      const first = ordered[0];
      const last = ordered.at(-1);
      const totalStep = ordered.find((entry) => entry.step === "total");
      const hasErrors = ordered.some((entry) => entry.status === "error");

      return {
        runId,
        cellId: first?.cellId ?? "",
        cellName: first?.cellName ?? null,
        workspaceId: first?.workspaceId ?? null,
        templateId: first?.templateId ?? null,
        workflow: (first?.workflow ?? "create") as CellTimingWorkflow,
        status: (hasErrors ? "error" : "ok") as CellTimingStatus,
        startedAt: first?.createdAt ?? "",
        finishedAt: last?.createdAt ?? "",
        totalDurationMs:
          totalStep?.durationMs ??
          ordered.reduce((sum, entry) => sum + entry.durationMs, 0),
        stepCount: ordered.length,
        attempt:
          ordered.find((entry) => entry.attempt != null)?.attempt ?? null,
      };
    })
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
}
