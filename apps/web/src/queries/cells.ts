import { fetchControllerJson } from "@/lib/controller-query";
import type {
  ActivityAttributesOnlySchema,
  CellAttributesOnlySchema,
  TimingAttributesOnlySchema,
} from "@/lib/generated/ash-rpc";
import {
  cellDiffPath,
  cellResourcesPath,
} from "@/lib/generated/controller-routes";
import { type CreateCellInput, rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export type CellStatus =
  | "spawning"
  | "pending"
  | "ready"
  | "error"
  | "deleting";

const DEFAULT_ACTIVITY_LIMIT = 50;
const DEFAULT_TIMING_LIMIT = 200;

type CellRecord = {
  id: string;
  name: string;
  description?: string | null;
  status: CellStatus;
  workspaceId: string;
  workspacePath?: string | null;
  workspaceRootPath?: string | null;
  createdAt?: string;
  updatedAt?: string;
  templateId: string;
  opencodeSessionId?: string | null;
  opencodeCommand?: string | null;
  lastSetupError?: string;
  currentMode?: "plan" | "build" | null;
  startMode?: "plan" | "build" | null;
  branchName?: string | null;
  baseCommit?: string | null;
  setupLog?: string | null;
  setupLogPath?: string | null;
};

type CellServiceRecord = {
  id: string;
  name: string;
  status: string;
  type?: string;
  command?: string;
  cwd?: string;
  port?: number | null;
  pid?: number | null;
  cpuPercent?: number | null;
  rssBytes?: number | null;
  lastKnownError?: string | null;
  recentLogs?: string | null;
  totalLogLines?: number | null;
  hasMoreLogs?: boolean;
  processAlive?: boolean;
  url?: string;
  portReachable?: boolean;
  resourceSampledAt?: string | null;
  resourceUnavailableReason?: string | null;
};

type CellResourceProcessRecord = {
  id: string;
  name: string;
  kind: string;
  serviceType?: string | null;
  active: boolean;
  status?: string | null;
  pid?: number | null;
  cpuPercent?: number | null;
  rssBytes?: number | null;
};

type CellResourceHistoryPoint = {
  activeCpuPercent: number;
  activeRssBytes: number;
  processes: CellResourceProcessRecord[];
};

type CellResourceHistoryAverageRecord = {
  window: string;
  averageActiveCpuPercent: number;
  averageActiveRssBytes: number;
  peakActiveCpuPercent: number;
  peakActiveRssBytes: number;
  sampleCount: number;
};

type CellResourceSummaryRecord = {
  sampledAt: string;
  processCount: number;
  activeProcessCount: number;
  activeCpuPercent: number;
  activeRssBytes: number;
  processes: CellResourceProcessRecord[];
  history?: CellResourceHistoryPoint[];
  historyAverages?: CellResourceHistoryAverageRecord[];
  message?: string;
  details?: string;
};

type CellActivityEventRecord = {
  id: string;
  type: string;
  createdAt: string;
  title?: string | null;
  description?: string | null;
  toolName?: string | null;
  metadata?: Record<string, unknown>;
};

type CellActivityResponse = {
  events: CellActivityEventRecord[];
  nextCursor?: string | null;
  message?: string;
  details?: string;
};

function buildOpencodeCommand(
  workspacePath: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  if (!(workspacePath && sessionId)) {
    return null;
  }

  return `opencode "${workspacePath}" --session "${sessionId}"`;
}

function presentCellStatus(status: string): CellStatus {
  return status === "provisioning" ? "pending" : (status as CellStatus);
}

function normalizeCell(
  cell: CellAttributesOnlySchema | CellRecord
): CellRecord {
  if ("insertedAt" in cell) {
    return {
      id: cell.id,
      name: cell.name,
      description: cell.description,
      status: presentCellStatus(cell.status),
      workspaceId: cell.workspaceId,
      workspacePath: cell.workspacePath,
      workspaceRootPath: cell.workspaceRootPath,
      createdAt: cell.insertedAt,
      updatedAt: cell.updatedAt,
      templateId: cell.templateId,
      opencodeSessionId: cell.opencodeSessionId,
      opencodeCommand: buildOpencodeCommand(
        cell.workspacePath,
        cell.opencodeSessionId
      ),
      lastSetupError: cell.lastSetupError ?? undefined,
      branchName: cell.branchName ?? undefined,
      baseCommit: cell.baseCommit ?? undefined,
    };
  }

  return {
    ...cell,
    status: presentCellStatus(cell.status),
    lastSetupError: cell.lastSetupError ?? undefined,
  };
}

function buildActivityCursor(insertedAt: string, id: string): string | null {
  const timestamp = Date.parse(insertedAt);
  return Number.isNaN(timestamp) ? null : `${timestamp}:${id}`;
}

function toActivityResponse(
  activities: ActivityAttributesOnlySchema[],
  limit: number
): CellActivityResponse {
  const page = activities.slice(0, limit);
  const lastEvent = page.at(-1);

  return {
    events: page.map((activity) => ({
      id: activity.id,
      type: activity.type,
      createdAt: activity.insertedAt,
      toolName: activity.toolName,
      metadata: activity.metadata,
    })),
    nextCursor:
      activities.length > limit && lastEvent
        ? buildActivityCursor(lastEvent.insertedAt, lastEvent.id)
        : null,
  };
}

function toTimingStep(timing: TimingAttributesOnlySchema): CellTimingStep {
  return {
    id: timing.id,
    cellId: timing.cellId ?? "",
    cellName: timing.cellName,
    workspaceId: timing.workspaceId,
    templateId: timing.templateId,
    runId: timing.runId,
    workflow: timing.workflow as CellTimingWorkflow,
    step: timing.step,
    status: timing.status as CellTimingStatus,
    durationMs: timing.durationMs,
    attempt: timing.attempt,
    error: timing.error,
    metadata: timing.metadata,
    createdAt: timing.insertedAt,
  };
}

function toTimingRuns(timings: TimingAttributesOnlySchema[]): CellTimingRun[] {
  return Array.from(
    timings.reduce((runs, timing) => {
      const entries = runs.get(timing.runId) ?? [];
      entries.push(timing);
      runs.set(timing.runId, entries);
      return runs;
    }, new Map<string, TimingAttributesOnlySchema[]>())
  )
    .map(([runId, runSteps]) => {
      const ordered = [...runSteps].sort((left, right) =>
        left.insertedAt.localeCompare(right.insertedAt)
      );
      const first = ordered[0];
      const last = ordered.at(-1);
      const totalStep = ordered.find((step) => step.step === "total");

      return {
        runId,
        cellId: first?.cellId ?? "",
        cellName: first?.cellName ?? null,
        workspaceId: first?.workspaceId ?? null,
        templateId: first?.templateId ?? null,
        workflow: (first?.workflow ?? "create") as CellTimingWorkflow,
        status: (ordered.some((step) => step.status === "error")
          ? "error"
          : "ok") as CellTimingStatus,
        startedAt: first?.insertedAt ?? "",
        finishedAt: last?.insertedAt ?? "",
        totalDurationMs: totalStep
          ? totalStep.durationMs
          : ordered.reduce((sum, step) => sum + step.durationMs, 0),
        stepCount: ordered.length,
        attempt: ordered.find((step) => step.attempt != null)?.attempt ?? null,
      };
    })
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
}

function toTimingResponse(
  timings: TimingAttributesOnlySchema[],
  limit: number
): CellTimingResponse {
  return {
    steps: timings.slice(0, limit).map(toTimingStep),
    runs: toTimingRuns(timings),
  };
}

export const cellQueries = {
  all: (workspaceId: string) => ({
    queryKey: ["cells", workspaceId] as const,
    staleTime: 0,
    queryFn: async (): Promise<CellRecord[]> => {
      const { data, error } = await rpc.api.cells.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to fetch cells"));
      }

      return Array.isArray(data)
        ? (data as CellAttributesOnlySchema[]).map(normalizeCell)
        : [];
    },
  }),

  detail: (id: string) => ({
    queryKey: ["cells", id] as const,
    staleTime: 0,
    queryFn: async (): Promise<CellRecord & { status: CellStatus }> => {
      const { data, error } = await rpc.api.cells({ id }).get();
      if (error) {
        throw new Error(formatRpcError(error, "Cell not found"));
      }

      return normalizeCell(data as CellAttributesOnlySchema);
    },
  }),

  services: (id: string, options: { includeResources?: boolean } = {}) => ({
    queryKey: [
      "cells",
      id,
      "services",
      options.includeResources ?? false,
    ] as const,
    queryFn: async (): Promise<CellServiceRecord[]> => {
      const { data, error } = await rpc.api.cells({ id }).services.get({
        query: {
          includeResources: options.includeResources,
        },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load services"));
      }

      return data as CellServiceRecord[];
    },
  }),

  resources: (
    id: string,
    options: {
      includeHistory?: boolean;
      includeAverages?: boolean;
      includeRollups?: boolean;
      historyLimit?: number;
      rollupLimit?: number;
    } = {}
  ) => ({
    queryKey: [
      "cells",
      id,
      "resources",
      options.includeHistory ?? false,
      options.includeAverages ?? false,
      options.includeRollups ?? false,
      options.historyLimit ?? null,
      options.rollupLimit ?? null,
    ] as const,
    queryFn: async (): Promise<CellResourceSummaryRecord> =>
      fetchControllerJson<CellResourceSummaryRecord>(
        cellResourcesPath(
          { id },
          {
            includeHistory: options.includeHistory,
            includeAverages: options.includeAverages,
            includeRollups: options.includeRollups,
            historyLimit: options.historyLimit,
            rollupLimit: options.rollupLimit,
          }
        ),
        "Failed to load resources"
      ),
  }),

  activity: (
    id: string,
    options: {
      limit?: number;
      cursor?: string;
      types?: string[];
    } = {}
  ) => ({
    queryKey: [
      "cells",
      id,
      "activity",
      options.limit ?? null,
      options.cursor ?? null,
      options.types?.join(",") ?? null,
    ] as const,
    queryFn: async (): Promise<CellActivityResponse> => {
      const query: Record<string, string | number> = {};
      if (typeof options.limit === "number") {
        query.limit = options.limit;
      }
      if (options.cursor) {
        query.cursor = options.cursor;
      }
      if (options.types?.length) {
        query.types = options.types.join(",");
      }

      const { data, error } = await rpc.api.cells({ id }).activity.get({
        query,
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load activity"));
      }

      return toActivityResponse(
        Array.isArray(data) ? (data as ActivityAttributesOnlySchema[]) : [],
        options.limit ?? DEFAULT_ACTIVITY_LIMIT
      );
    },
  }),

  timings: (
    id: string,
    options: {
      limit?: number;
      workflow?: "all" | "create" | "delete";
      runId?: string;
    } = {}
  ) => ({
    queryKey: [
      "cells",
      id,
      "timings",
      options.limit ?? null,
      options.workflow ?? "all",
      options.runId ?? null,
    ] as const,
    queryFn: async (): Promise<CellTimingResponse> => {
      const query: Record<string, string | number> = {};
      if (typeof options.limit === "number") {
        query.limit = options.limit;
      }
      if (options.workflow) {
        query.workflow = options.workflow;
      }
      if (options.runId) {
        query.runId = options.runId;
      }

      const { data, error } = await rpc.api.cells({ id }).timings.get({
        query,
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load timings"));
      }

      return toTimingResponse(
        Array.isArray(data) ? (data as TimingAttributesOnlySchema[]) : [],
        options.limit ?? DEFAULT_TIMING_LIMIT
      );
    },
  }),

  timingsGlobal: (
    options: {
      limit?: number;
      workflow?: "all" | "create" | "delete";
      runId?: string;
      workspaceId?: string;
      cellId?: string;
    } = {}
  ) => ({
    queryKey: [
      "cells",
      "timings",
      "global",
      options.limit ?? null,
      options.workflow ?? "all",
      options.runId ?? null,
      options.workspaceId ?? null,
      options.cellId ?? null,
    ] as const,
    queryFn: async (): Promise<CellTimingResponse> => {
      const query: Record<string, string | number> = {};
      if (typeof options.limit === "number") {
        query.limit = options.limit;
      }
      if (options.workflow) {
        query.workflow = options.workflow;
      }
      if (options.runId) {
        query.runId = options.runId;
      }
      if (options.workspaceId) {
        query.workspaceId = options.workspaceId;
      }
      if (options.cellId) {
        query.cellId = options.cellId;
      }

      const { data, error } = await rpc.api.cells.timings.global.get({
        query,
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load timings"));
      }

      return toTimingResponse(
        Array.isArray(data) ? (data as TimingAttributesOnlySchema[]) : [],
        options.limit ?? DEFAULT_TIMING_LIMIT
      );
    },
  }),
};

type ServiceActionInput = {
  cellId: string;
  serviceId: string;
  serviceName: string;
};

type ServiceBulkActionInput = {
  cellId: string;
};

export const cellMutations = {
  create: {
    mutationFn: async (input: CreateCellInput) => {
      const { data, error } = await rpc.api.cells.post(input);
      if (error) {
        throw new Error(formatRpcError(error, "Failed to create cell"));
      }

      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Failed to create cell"));
      }

      return normalizeCell(data as CellRecord);
    },
  },

  delete: {
    mutationFn: async (id: string) => {
      const { data, error } = await rpc.api.cells({ id }).delete();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to delete cell"));
      }
      return data;
    },
  },

  deleteMany: {
    mutationFn: async (ids: string[]) => {
      const { data, error } = await rpc.api.cells.delete({ ids });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to delete cells"));
      }

      const result = data as { deletedIds: string[]; failedIds?: string[] };

      if (result.deletedIds.length === 0) {
        throw new Error("No cells found for provided ids");
      }

      return result;
    },
  },

  startService: {
    mutationFn: async ({ cellId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services({ serviceId })
        .start.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to start service"));
      }
      return data;
    },
  },

  stopService: {
    mutationFn: async ({ cellId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services({ serviceId })
        .stop.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to stop service"));
      }
      return data;
    },
  },

  restartService: {
    mutationFn: async ({ cellId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services({ serviceId })
        .restart.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to restart service"));
      }
      return data;
    },
  },

  startAllServices: {
    mutationFn: async ({ cellId }: ServiceBulkActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services.start.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to start services"));
      }
      return data;
    },
  },

  stopAllServices: {
    mutationFn: async ({ cellId }: ServiceBulkActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services.stop.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to stop services"));
      }
      return data;
    },
  },

  restartAllServices: {
    mutationFn: async ({ cellId }: ServiceBulkActionInput) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .services.restart.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to restart services"));
      }
      return data;
    },
  },

  retrySetup: {
    mutationFn: async (cellId: string) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .setup.retry.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to retry setup"));
      }
      return normalizeCell(data as CellRecord);
    },
  },
};

export const cellDiffQueries = {
  summary: (
    cellId: string,
    mode: DiffMode,
    options: { files?: string[] } = {}
  ) => ({
    queryKey: ["cell-diff", cellId, mode, "summary"] as const,
    queryFn: async (): Promise<CellDiffResponse> =>
      fetchControllerJson<CellDiffResponse>(
        cellDiffPath(
          { id: cellId },
          {
            mode,
            files: options.files?.length ? options.files.join(",") : undefined,
          }
        ),
        "Failed to load cell diff"
      ),
  }),
  detail: (cellId: string, mode: DiffMode, file: string) => ({
    queryKey: ["cell-diff", cellId, mode, "detail", file] as const,
    queryFn: async (): Promise<DiffFileDetail | null> => {
      const data = await fetchControllerJson<CellDiffResponse>(
        cellDiffPath(
          { id: cellId },
          {
            mode,
            files: file,
            summary: "none",
          }
        ),
        `Failed to load diff for ${file}`
      );
      const details = (data.details ?? []) as DiffFileDetail[];
      return details.find((detail) => detail.path === file) ?? null;
    },
  }),
};

// Export inferred types for use in components
export type Cell = Awaited<
  ReturnType<ReturnType<typeof cellQueries.detail>["queryFn"]>
> & {
  status: CellStatus;
  opencodeCommand?: string | null;
  lastSetupError?: string;
  branchName?: string | null;
  baseCommit?: string | null;
  setupLog?: string | null;
  setupLogPath?: string | null;
};

export type CellServiceSummary = Awaited<
  ReturnType<ReturnType<typeof cellQueries.services>["queryFn"]>
>[number];

export type CellResourceSummary = Awaited<
  ReturnType<ReturnType<typeof cellQueries.resources>["queryFn"]>
>;

export type CellResourceProcess = CellResourceSummary["processes"][number];

export type CellActivityEventListResponse = Awaited<
  ReturnType<ReturnType<typeof cellQueries.activity>["queryFn"]>
>;

export type CellActivityEvent = CellActivityEventListResponse["events"][number];

export type CellTimingStatus = "ok" | "error";
export type CellTimingWorkflow = "create" | "delete";

export type CellTimingStep = {
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

export type CellTimingRun = {
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

export type CellTimingResponse = {
  steps: CellTimingStep[];
  runs: CellTimingRun[];
};

export type DiffMode = "workspace" | "branch";

export type DiffFileSummary = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
};

export type DiffFileDetail = DiffFileSummary & {
  beforeContent?: string | null;
  afterContent?: string | null;
  patch?: string | null;
};

export type CellDiffResponse = {
  mode: DiffMode;
  baseCommit?: string | null;
  headCommit?: string | null;
  files: DiffFileSummary[];
  details?: DiffFileDetail[];
};
