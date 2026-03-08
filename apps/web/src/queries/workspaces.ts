import type { WorkspaceAttributesOnlySchema } from "@/lib/generated/ash-rpc";
import { rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

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

function ensureWorkspaceResponse(
  data: unknown,
  fallbackMessage: string
): WorkspaceSummary {
  if (
    data &&
    typeof data === "object" &&
    "workspace" in data &&
    data.workspace &&
    typeof (data as { workspace: unknown }).workspace === "object"
  ) {
    return (data as { workspace: WorkspaceSummary }).workspace;
  }
  throw new Error(fallbackMessage);
}

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
  browse: (path?: string, filter?: string) => ({
    queryKey: ["workspace-browse", path ?? "__root__", filter ?? ""] as const,
    queryFn: async (): Promise<WorkspaceBrowseResponse> => {
      type BrowseArgs = Parameters<
        (typeof rpc.api.workspaces.browse)["get"]
      >[0];

      const args: BrowseArgs =
        path || filter ? { query: { path, filter } } : undefined;
      const { data, error } = await rpc.api.workspaces.browse.get(args);
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load directories"));
      }
      if (
        !data ||
        typeof data !== "object" ||
        !("directories" in data) ||
        !Array.isArray((data as { directories?: unknown }).directories)
      ) {
        throw new Error("Invalid directory response");
      }
      return data as WorkspaceBrowseResponse;
    },
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
      return normalizeWorkspace(
        ensureWorkspaceResponse(data, "Failed to register workspace")
      );
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
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        !("workspace" in data)
      ) {
        throw new Error(
          formatRpcResponseError(data, "Failed to activate workspace")
        );
      }
      return normalizeWorkspace(
        ensureWorkspaceResponse(data, "Failed to activate workspace")
      );
    },
  },
  remove: {
    mutationFn: async ({ id }: RemoveWorkspaceInput): Promise<void> => {
      const { data, error } = await rpc.api.workspaces({ id }).delete();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to remove workspace"));
      }
      if (data && typeof data === "object" && "message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to remove workspace")
        );
      }
    },
  },
};
