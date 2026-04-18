import { rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

export type LinearUser = {
  id: string;
  name: string;
  email: string | null;
};

export type LinearOrganization = {
  id: string;
  name: string;
};

export type LinearTeam = {
  id: string;
  key: string | null;
  name: string;
};

export type LinearIssueState = {
  id: string;
  name: string;
  color: string | null;
};

export type LinearIssue = {
  id: string;
  teamId: string | null;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  updatedAt: string;
  completedAt: string | null;
  state: LinearIssueState | null;
  assignee: LinearUser | null;
};

export type LinearStatus = {
  connected: boolean;
  user: LinearUser | null;
  organization: LinearOrganization | null;
  team: LinearTeam | null;
};

export type LinearIssueListResponse = {
  issues: LinearIssue[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type SaveLinearTokenInput = {
  workspaceId: string;
  accessToken: string;
};

export type LinkLinearTeamInput = {
  workspaceId: string;
  teamId: string;
};

const ensureSuccessPayload = <T>(data: unknown, fallbackMessage: string): T => {
  if (data && typeof data === "object" && "message" in data) {
    throw new Error(formatRpcResponseError(data, fallbackMessage));
  }

  return data as T;
};

export const linearQueries = {
  status: (workspaceId: string) => ({
    queryKey: ["linear", "status", workspaceId] as const,
    queryFn: async (): Promise<LinearStatus> => {
      const { data, error } = await rpc.api.linear.status.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load Linear status"));
      }
      return ensureSuccessPayload<LinearStatus>(
        data,
        "Failed to load Linear status"
      );
    },
  }),
  teams: (workspaceId: string) => ({
    queryKey: ["linear", "teams", workspaceId] as const,
    queryFn: async (): Promise<{ teams: LinearTeam[] }> => {
      const { data, error } = await rpc.api.linear.teams.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load Linear teams"));
      }
      return ensureSuccessPayload<{ teams: LinearTeam[] }>(
        data,
        "Failed to load Linear teams"
      );
    },
  }),
  issuesPage: (workspaceId: string, after?: string) => ({
    queryKey: ["linear", "issues", workspaceId, after ?? null] as const,
    queryFn: async (): Promise<LinearIssueListResponse> => {
      const { data, error } = await rpc.api.linear.issues.get({
        query: {
          workspaceId,
          after,
        },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load Linear issues"));
      }
      return ensureSuccessPayload<LinearIssueListResponse>(
        data,
        "Failed to load Linear issues"
      );
    },
  }),
  issue: (workspaceId: string, issueId: string) => ({
    queryKey: ["linear", "issue", workspaceId, issueId] as const,
    queryFn: async (): Promise<LinearIssue> => {
      const { data, error } = await rpc.api.linear.issues({ issueId }).get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(
          formatRpcError(error, "Failed to load the Linear issue")
        );
      }
      return ensureSuccessPayload<LinearIssue>(
        data,
        "Failed to load the Linear issue"
      );
    },
  }),
};

export const linearMutations = {
  saveToken: {
    mutationFn: async ({
      workspaceId,
      accessToken,
    }: SaveLinearTokenInput): Promise<LinearStatus> => {
      const { data, error } = await rpc.api.linear.token.put({
        workspaceId,
        accessToken,
      });
      if (error) {
        throw new Error(
          formatRpcError(error, "Failed to save the Linear token")
        );
      }
      return ensureSuccessPayload<LinearStatus>(
        data,
        "Failed to save the Linear token"
      );
    },
  },
  linkTeam: {
    mutationFn: async ({ workspaceId, teamId }: LinkLinearTeamInput) => {
      const { data, error } = await rpc.api.linear.team.put({
        workspaceId,
        teamId,
      });
      if (error) {
        throw new Error(
          formatRpcError(error, "Failed to link the Linear team")
        );
      }
      return ensureSuccessPayload<LinearStatus>(
        data,
        "Failed to link the Linear team"
      );
    },
  },
  disconnect: {
    mutationFn: async (workspaceId: string): Promise<void> => {
      const { data, error } = await rpc.api.linear.delete({
        query: { workspaceId },
      });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to disconnect Linear"));
      }
      if (data && typeof data === "object" && "message" in data) {
        throw new Error(
          formatRpcResponseError(data, "Failed to disconnect Linear")
        );
      }
    },
  },
};
