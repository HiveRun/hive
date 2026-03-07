import { type CreateCellInput, rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export type CellStatus =
  | "spawning"
  | "pending"
  | "ready"
  | "error"
  | "deleting";

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

type CellListResponse = {
  cells: CellRecord[];
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
  url?: string;
  portReachable?: boolean;
};

type CellServicesResponse = {
  services: CellServiceRecord[];
  message?: string;
  details?: string;
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
      return (data as CellListResponse).cells.map(normalizeCell);
    },
  }),

  detail: (id: string) => ({
    queryKey: ["cells", id] as const,
    staleTime: 0,
    queryFn: async (): Promise<CellRecord & { status: CellStatus }> => {
      const { data, error } = await rpc.api.cells({ id }).get({
        query: {
          includeSetupLog: false,
        },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Cell not found"));
      }

      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Cell not found"));
      }

      return normalizeCell(stripNullCellFields(data as CellRecord));
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

      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Cell not found"));
      }

      return (data as CellServicesResponse).services;
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
    queryFn: async (): Promise<CellResourceSummaryRecord> => {
      const { data, error } = await rpc.api.cells({ id }).resources.get({
        query: {
          includeHistory: options.includeHistory,
          includeAverages: options.includeAverages,
          includeRollups: options.includeRollups,
          historyLimit: options.historyLimit,
          rollupLimit: options.rollupLimit,
        },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load resources"));
      }

      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Cell not found"));
      }

      return data as CellResourceSummaryRecord;
    },
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
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(
          formatRpcResponseError(data, "Failed to load activity")
        );
      }

      return data as CellActivityResponse;
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
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Failed to load timings"));
      }

      return data as CellTimingResponse;
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

      return data as CellTimingResponse;
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

      return normalizeCell(stripNullCellFields(data as CellRecord));
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

      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        throw new Error(formatRpcResponseError(data, "Failed to delete cells"));
      }

      return data as { deletedIds: string[] };
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

  retrySetup: {
    mutationFn: async (cellId: string) => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .setup.retry.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to retry setup"));
      }
      return normalizeCell(stripNullCellFields(data as CellRecord));
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
    queryFn: async (): Promise<CellDiffResponse> => {
      const query: Record<string, string> = { mode };
      if (options.files?.length) {
        query.files = options.files.join(",");
      }
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .diff.get({ query });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load cell diff"));
      }
      return data as CellDiffResponse;
    },
  }),
  detail: (cellId: string, mode: DiffMode, file: string) => ({
    queryKey: ["cell-diff", cellId, mode, "detail", file] as const,
    queryFn: async (): Promise<DiffFileDetail | null> => {
      const { data, error } = await rpc.api.cells({ id: cellId }).diff.get({
        query: {
          mode,
          files: file,
          summary: "none",
        },
      });
      if (error) {
        throw new Error(
          formatRpcError(error, `Failed to load diff for ${file}`)
        );
      }
      const details = ((data as CellDiffResponse).details ??
        []) as DiffFileDetail[];
      return details.find((detail) => detail.path === file) ?? null;
    },
  }),
};

const stripNullCellFields = (cell: CellRecord): CellRecord => ({
  ...cell,
  lastSetupError: cell.lastSetupError ?? undefined,
});

const normalizeCell = <T extends { status: CellStatus }>(
  cell: T
): T & { status: CellStatus } => ({
  ...cell,
  status: cell.status,
});

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
