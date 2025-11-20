import { type CreateConstructInput, rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export const constructQueries = {
  all: (workspaceId: string) => ({
    queryKey: ["constructs", workspaceId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to fetch constructs"));
      }
      return data.constructs.map(normalizeConstruct);
    },
  }),

  detail: (id: string) => ({
    queryKey: ["constructs", id] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs({ id }).get();
      if (error) {
        throw new Error(formatRpcError(error, "Construct not found"));
      }

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Construct not found"));
      }

      return normalizeConstruct(data);
    },
  }),

  services: (id: string) => ({
    queryKey: ["constructs", id, "services"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.constructs({ id }).services.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load services"));
      }

      if ("message" in data) {
        throw new Error(formatRpcResponseError(data, "Construct not found"));
      }

      return data.services;
    },
  }),
};

type ServiceActionInput = {
  constructId: string;
  serviceId: string;
  serviceName: string;
};

export const constructMutations = {
  create: {
    mutationFn: async (input: CreateConstructInput) => {
      const { data, error } = await rpc.api.constructs.post(input);
      if (error) {
        throw new Error(formatRpcError(error, "Failed to create construct"));
      }

      if ("message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to create construct")
        );
      }

      return normalizeConstruct(data);
    },
  },

  delete: {
    mutationFn: async (id: string) => {
      const { data, error } = await rpc.api.constructs({ id }).delete();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to delete construct"));
      }
      return data;
    },
  },

  deleteMany: {
    mutationFn: async (ids: string[]) => {
      const { data, error } = await rpc.api.constructs.delete({ ids });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to delete constructs"));
      }

      if ("message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to delete constructs")
        );
      }

      return data;
    },
  },

  startService: {
    mutationFn: async ({ constructId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .services({ serviceId })
        .start.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to start service"));
      }
      return data;
    },
  },

  stopService: {
    mutationFn: async ({ constructId, serviceId }: ServiceActionInput) => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .services({ serviceId })
        .stop.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to stop service"));
      }
      return data;
    },
  },
};

export const constructDiffQueries = {
  summary: (
    constructId: string,
    mode: DiffMode,
    options: { files?: string[] } = {}
  ) => ({
    queryKey: ["construct-diff", constructId, mode, "summary"] as const,
    queryFn: async (): Promise<ConstructDiffResponse> => {
      const query: Record<string, string> = { mode };
      if (options.files?.length) {
        query.files = options.files.join(",");
      }
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .diff.get({ query });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load construct diff"));
      }
      return data as ConstructDiffResponse;
    },
  }),
  detail: (constructId: string, mode: DiffMode, file: string) => ({
    queryKey: ["construct-diff", constructId, mode, "detail", file] as const,
    queryFn: async (): Promise<DiffFileDetail | null> => {
      const { data, error } = await rpc.api
        .constructs({ id: constructId })
        .diff.get({
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

const normalizeConstruct = <T extends { status: string }>(
  construct: T
): T & { status: ConstructStatus } => ({
  ...construct,
  status: construct.status as ConstructStatus,
});

// Export inferred types for use in components
export type ConstructStatus = "pending" | "ready" | "error";

export type Construct = Awaited<
  ReturnType<ReturnType<typeof constructQueries.detail>["queryFn"]>
> & {
  status: ConstructStatus;
  lastSetupError?: string;
  branchName?: string | null;
  baseCommit?: string | null;
};

export type ConstructServiceSummary = Awaited<
  ReturnType<ReturnType<typeof constructQueries.services>["queryFn"]>
>[number];

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

export type ConstructDiffResponse = {
  mode: DiffMode;
  baseCommit?: string | null;
  headCommit?: string | null;
  files: DiffFileSummary[];
  details?: DiffFileDetail[];
};
