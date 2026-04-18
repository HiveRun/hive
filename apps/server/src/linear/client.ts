import {
  type Issue,
  type IssueConnection,
  LinearClient,
  LinearDocument,
  type Organization,
  type User,
} from "@linear/sdk";

const DEFAULT_TEAM_PAGE_SIZE = 100;
const DEFAULT_ISSUE_PAGE_SIZE = 50;

export class LinearAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearAuthenticationError";
  }
}

export const createLinearClient = (accessToken: string) =>
  new LinearClient({ apiKey: accessToken });

export const fetchLinearViewerContext = async (
  client: LinearClient
): Promise<{
  viewer: User;
  organization: Organization;
}> => {
  const [viewer, organization] = await Promise.all([
    client.viewer,
    client.organization,
  ]);
  return { viewer, organization };
};

export const listLinearTeams = async (
  client: LinearClient,
  first = DEFAULT_TEAM_PAGE_SIZE
) => {
  const teamConnection = await client.teams({
    first,
    includeArchived: false,
  });

  return [...teamConnection.nodes]
    .filter((team) => !team.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const fetchLinearTeam = async (client: LinearClient, teamId: string) =>
  await client.team(teamId);

export const listLinearTeamIssues = async ({
  client,
  teamId,
  after,
  first = DEFAULT_ISSUE_PAGE_SIZE,
}: {
  client: LinearClient;
  teamId: string;
  after?: string;
  first?: number;
}): Promise<IssueConnection> => {
  const team = await fetchLinearTeam(client, teamId);
  return await team.issues({
    after,
    first,
    includeArchived: false,
    orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
  });
};

export const fetchLinearIssue = async (
  client: LinearClient,
  issueId: string
): Promise<Issue> => await client.issue(issueId);
