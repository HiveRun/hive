import type {
  Issue,
  Organization,
  Team,
  User,
  WorkflowState,
} from "@linear/sdk";
import type { StoredLinearIntegration } from "./repository";

export type LinearStatusPayload = {
  connected: boolean;
  user: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  organization: {
    id: string;
    name: string;
  } | null;
  team: {
    id: string;
    key: string | null;
    name: string;
  } | null;
};

export type LinearIssuePayload = {
  id: string;
  teamId: string | null;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  updatedAt: string;
  completedAt: string | null;
  state: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  assignee: {
    id: string;
    name: string;
    email: string | null;
  } | null;
};

export const mapLinearTeam = (team: Team) => ({
  id: team.id,
  key: team.key ?? null,
  name: team.name,
});

export const mapLinearUser = (user: User) => ({
  id: user.id,
  name: user.displayName || user.name || user.email || user.id,
  email: user.email ?? null,
});

export const mapLinearOrganization = (organization: Organization) => ({
  id: organization.id,
  name: organization.name,
});

const mapLinearWorkflowState = (state: WorkflowState | undefined) => {
  if (!state) {
    return null;
  }

  return {
    id: state.id,
    name: state.name,
    color: state.color ?? null,
  };
};

export const mapLinearStatus = (
  integration: StoredLinearIntegration | null
): LinearStatusPayload => {
  if (!integration) {
    return {
      connected: false,
      user: null,
      organization: null,
      team: null,
    };
  }

  return {
    connected: true,
    user: {
      id: integration.linearUserId,
      name:
        integration.linearUserName ??
        integration.linearUserEmail ??
        integration.linearUserId,
      email: integration.linearUserEmail ?? null,
    },
    organization:
      integration.linearOrganizationId && integration.linearOrganizationName
        ? {
            id: integration.linearOrganizationId,
            name: integration.linearOrganizationName,
          }
        : null,
    team:
      integration.teamId && integration.teamName
        ? {
            id: integration.teamId,
            key: integration.teamKey ?? null,
            name: integration.teamName,
          }
        : null,
  };
};

export const mapLinearIssue = async (
  issue: Issue,
  { includeDescription = false }: { includeDescription?: boolean } = {}
): Promise<LinearIssuePayload> => {
  const [assignee, state] = await Promise.all([issue.assignee, issue.state]);

  return {
    id: issue.id,
    teamId: issue.teamId ?? null,
    identifier: issue.identifier,
    title: issue.title,
    description: includeDescription ? (issue.description ?? null) : null,
    url: issue.url ?? null,
    updatedAt: issue.updatedAt.toISOString(),
    completedAt: issue.completedAt ? issue.completedAt.toISOString() : null,
    state: mapLinearWorkflowState(state),
    assignee: assignee ? mapLinearUser(assignee) : null,
  };
};
