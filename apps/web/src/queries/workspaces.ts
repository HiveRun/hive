import { fetchControllerJson } from "@/lib/controller-query";
import type { WorkspaceAttributesOnlySchema } from "@/lib/generated/ash-rpc";
import { workspaceBrowsePath } from "@/lib/generated/controller-routes";
import { rpc } from "@/lib/rpc";
import { formatRpcError } from "@/lib/rpc-error";

export type WorkspaceSummary = {
  id: string;
  label: string;
  path: string;
  addedAt: string;
  lastOpenedAt?: string | null;
};

export type WorkspaceListResponse = {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId?: string | null;
};

export type WorkspaceOverviewService = {
  id: string;
  name: string;
  status: string;
  port?: number | null;
  cpuPercent?: number | null;
  rssBytes?: number | null;
};

export type WorkspaceOverviewCell = {
  id: string;
  name: string;
  description?: string | null;
  status: "provisioning" | "ready" | "stopped" | "error" | "deleting";
  workspaceId: string;
  templateId: string;
  templateLabel?: string | null;
  branchName?: string | null;
  baseCommit?: string | null;
  insertedAt?: string | null;
  updatedAt?: string | null;
  services: WorkspaceOverviewService[];
};

export type WorkspaceOverviewWorkspace = WorkspaceSummary & {
  cells: WorkspaceOverviewCell[];
};

export type WorkspaceOverviewResponse = {
  workspaces: WorkspaceOverviewWorkspace[];
  activeWorkspaceId?: string | null;
};

type WorkspaceOverviewRpcWorkspace = {
  id: string;
  label: string;
  path: string;
  insertedAt?: string | null;
  lastOpenedAt?: string | null;
  cells?: Array<{
    id: string;
    name: string;
    description?: string | null;
    status: WorkspaceOverviewCell["status"];
    workspaceId: string;
    templateId: string;
    templateLabel?: string | null;
    branchName?: string | null;
    baseCommit?: string | null;
    insertedAt?: string | null;
    updatedAt?: string | null;
    services?: WorkspaceOverviewService[];
  }>;
};

function deriveWorkspaceLabel(path: string, label: string | null): string {
  if (typeof label === "string" && label.trim() !== "") {
    return label;
  }

  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function normalizeWorkspace(
  workspace: WorkspaceAttributesOnlySchema | WorkspaceSummary
): WorkspaceSummary {
  if ("addedAt" in workspace) {
    return workspace;
  }

  return {
    id: workspace.id,
    label: deriveWorkspaceLabel(workspace.path, workspace.label),
    path: workspace.path,
    addedAt: workspace.insertedAt,
    lastOpenedAt: workspace.lastOpenedAt,
  };
}

export type WorkspaceBrowseEntry = {
  name: string;
  path: string;
  hasConfig: boolean;
};

export type WorkspaceBrowseResponse = {
  path: string;
  parentPath?: string | null;
  directories: WorkspaceBrowseEntry[];
};

export type RegisterWorkspaceInput = {
  path: string;
  label?: string;
  activate?: boolean;
};

export type ActivateWorkspaceInput = {
  id: string;
};

export type RemoveWorkspaceInput = {
  id: string;
};

export const workspaceQueries = {
  list: () => ({
    queryKey: ["workspaces"] as const,
    queryFn: async (): Promise<WorkspaceListResponse> => {
      const { data, error } = await rpc.api.workspaces.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load workspaces"));
      }
      const workspaces = Array.isArray(data)
        ? (data as WorkspaceAttributesOnlySchema[]).map(normalizeWorkspace)
        : [];

      return {
        workspaces,
        activeWorkspaceId: workspaces[0]?.id ?? null,
      } satisfies WorkspaceListResponse;
    },
  }),
  overview: () => ({
    queryKey: ["workspaces", "overview"] as const,
    staleTime: 15_000,
    queryFn: async (): Promise<WorkspaceOverviewResponse> => {
      const { data, error } = await rpc.api.workspaces.overview.get();
      if (error) {
        throw new Error(
          formatRpcError(error, "Failed to load workspace overview")
        );
      }

      const response = (data as WorkspaceOverviewResponse) ?? {
        workspaces: [],
        activeWorkspaceId: null,
      };

      return {
        workspaces: (
          response.workspaces as WorkspaceOverviewRpcWorkspace[]
        ).map((workspace) => ({
          id: workspace.id,
          label: deriveWorkspaceLabel(workspace.path, workspace.label),
          path: workspace.path,
          addedAt: workspace.insertedAt ?? "",
          lastOpenedAt: workspace.lastOpenedAt ?? null,
          cells: (workspace.cells ?? []).map((cell) => ({
            id: cell.id,
            name: cell.name,
            description: cell.description,
            status: cell.status,
            workspaceId: cell.workspaceId,
            templateId: cell.templateId,
            templateLabel: cell.templateLabel ?? null,
            branchName: cell.branchName ?? null,
            baseCommit: cell.baseCommit ?? null,
            insertedAt: cell.insertedAt ?? null,
            updatedAt: cell.updatedAt ?? null,
            services: cell.services ?? [],
          })),
        })),
        activeWorkspaceId: response.activeWorkspaceId ?? null,
      };
    },
  }),
  browse: (path?: string, filter?: string) => ({
    queryKey: ["workspace-browse", path ?? "__root__", filter ?? ""] as const,
    queryFn: async (): Promise<WorkspaceBrowseResponse> =>
      fetchControllerJson<WorkspaceBrowseResponse>(
        workspaceBrowsePath(path || filter ? { path, filter } : undefined),
        "Failed to load directories"
      ).then((data) => {
        if (
          !data ||
          typeof data !== "object" ||
          !Array.isArray((data as { directories?: unknown }).directories)
        ) {
          throw new Error("Invalid directory response");
        }

        return data;
      }),
  }),
};

export const workspaceMutations = {
  register: {
    mutationFn: async (
      input: RegisterWorkspaceInput
    ): Promise<WorkspaceSummary> => {
      const { data, error } = await rpc.api.workspaces.post(input);
      if (error) {
        throw new Error(formatRpcError(error, "Failed to register workspace"));
      }
      return normalizeWorkspace(data as WorkspaceAttributesOnlySchema);
    },
  },
  activate: {
    mutationFn: async ({
      id,
    }: ActivateWorkspaceInput): Promise<WorkspaceSummary> => {
      const { data, error } = await rpc.api.workspaces({ id }).activate.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to activate workspace"));
      }
      return normalizeWorkspace(data as WorkspaceAttributesOnlySchema);
    },
  },
  remove: {
    mutationFn: async ({ id }: RemoveWorkspaceInput): Promise<void> => {
      const { error } = await rpc.api.workspaces({ id }).delete();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to remove workspace"));
      }
    },
  },
};
