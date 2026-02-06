import { type CreateCellInput, rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export const cellQueries = {
  all: (workspaceId: string) => ({
    queryKey: ["cells", workspaceId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.cells.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to fetch cells"));
      }
      return data.cells.map(normalizeCell);
    },
  }),

  detail: (id: string) => ({
    queryKey: ["cells", id] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.cells({ id }).get();
      if (error) {
        throw new Error(formatRpcError(error, "Cell not found"));
      }

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Cell not found"));
      }

      return normalizeCell(data);
    },
  }),

  services: (id: string) => ({
    queryKey: ["cells", id, "services"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.cells({ id }).services.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load services"));
      }

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Cell not found"));
      }

      return data.services;
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
    queryFn: async () => {
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
      if ("message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to load activity")
        );
      }

      return data;
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

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Failed to create cell"));
      }

      return normalizeCell(data);
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

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Failed to delete cells"));
      }

      return data;
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
      return normalizeCell(data);
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
      const details = (data.details as DiffFileDetail[] | undefined) ?? [];
      return details.find((detail) => detail.path === file) ?? null;
    },
  }),
};

const normalizeCell = <T extends { status: string }>(
  cell: T
): T & { status: CellStatus } => ({
  ...cell,
  status: cell.status as CellStatus,
});

// Export inferred types for use in components
export type CellStatus = "spawning" | "pending" | "ready" | "error";

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

export type CellActivityEventListResponse = Awaited<
  ReturnType<ReturnType<typeof cellQueries.activity>["queryFn"]>
>;

export type CellActivityEvent = CellActivityEventListResponse["events"][number];

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
