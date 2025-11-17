import { rpc } from "@/lib/rpc";

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

function extractErrorMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message?: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return fallback;
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export const workspaceQueries = {
  list: () => ({
    queryKey: ["workspaces"] as const,
    queryFn: async (): Promise<WorkspaceListResponse> => {
      const { data, error } = await rpc.api.workspaces.get();
      if (error) {
        throw new Error(formatErrorMessage(error, "Failed to load workspaces"));
      }
      if (
        !data ||
        typeof data !== "object" ||
        !("workspaces" in data) ||
        !Array.isArray((data as { workspaces?: unknown }).workspaces)
      ) {
        throw new Error("Invalid workspace response");
      }
      return data as WorkspaceListResponse;
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
        throw new Error(
          formatErrorMessage(error, "Failed to load directories")
        );
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
        throw new Error(
          formatErrorMessage(error, "Failed to register workspace")
        );
      }
      return ensureWorkspaceResponse(data, "Failed to register workspace");
    },
  },
  activate: {
    mutationFn: async ({
      id,
    }: ActivateWorkspaceInput): Promise<WorkspaceSummary> => {
      const { data, error } = await rpc.api.workspaces({ id }).activate.post();
      if (error) {
        throw new Error(
          formatErrorMessage(error, "Failed to activate workspace")
        );
      }
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        !("workspace" in data)
      ) {
        throw new Error(
          extractErrorMessage(data, "Failed to activate workspace")
        );
      }
      return ensureWorkspaceResponse(data, "Failed to activate workspace");
    },
  },
  remove: {
    mutationFn: async ({ id }: RemoveWorkspaceInput): Promise<void> => {
      const { data, error } = await rpc.api.workspaces({ id }).delete();
      if (error) {
        throw new Error(
          formatErrorMessage(error, "Failed to remove workspace")
        );
      }
      if (data && typeof data === "object" && "message" in data) {
        throw new Error(
          extractErrorMessage(data, "Failed to remove workspace")
        );
      }
    },
  },
};
