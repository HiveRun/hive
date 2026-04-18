import { eq } from "drizzle-orm";
import type { DatabaseService as DatabaseServiceType } from "../db";
import { linearIntegrations } from "../schema/linear-integrations";

type DatabaseClient = DatabaseServiceType["db"];

export type StoredLinearIntegration = typeof linearIntegrations.$inferSelect;

export type UpsertLinearConnectionInput = {
  workspaceId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  tokenType: string | null;
  scope: string | null;
  linearUserId: string;
  linearUserName: string | null;
  linearUserEmail: string | null;
  linearOrganizationId: string | null;
  linearOrganizationName: string | null;
};

export const getLinearIntegration = async (
  db: DatabaseClient,
  workspaceId: string
): Promise<StoredLinearIntegration | null> => {
  const [integration] = await db
    .select()
    .from(linearIntegrations)
    .where(eq(linearIntegrations.workspaceId, workspaceId))
    .limit(1);

  return integration ?? null;
};

export const upsertLinearConnection = async (
  db: DatabaseClient,
  input: UpsertLinearConnectionInput
) => {
  const now = new Date();

  await db
    .insert(linearIntegrations)
    .values({
      workspaceId: input.workspaceId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      tokenType: input.tokenType,
      scope: input.scope,
      linearUserId: input.linearUserId,
      linearUserName: input.linearUserName,
      linearUserEmail: input.linearUserEmail,
      linearOrganizationId: input.linearOrganizationId,
      linearOrganizationName: input.linearOrganizationName,
      teamId: null,
      teamKey: null,
      teamName: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: linearIntegrations.workspaceId,
      set: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        tokenType: input.tokenType,
        scope: input.scope,
        linearUserId: input.linearUserId,
        linearUserName: input.linearUserName,
        linearUserEmail: input.linearUserEmail,
        linearOrganizationId: input.linearOrganizationId,
        linearOrganizationName: input.linearOrganizationName,
        teamId: null,
        teamKey: null,
        teamName: null,
        updatedAt: now,
      },
    });

  return await getLinearIntegration(db, input.workspaceId);
};

export const updateLinearTokens = async (
  db: DatabaseClient,
  workspaceId: string,
  input: Pick<
    UpsertLinearConnectionInput,
    | "accessToken"
    | "refreshToken"
    | "accessTokenExpiresAt"
    | "tokenType"
    | "scope"
  >
) => {
  await db
    .update(linearIntegrations)
    .set({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      tokenType: input.tokenType,
      scope: input.scope,
      updatedAt: new Date(),
    })
    .where(eq(linearIntegrations.workspaceId, workspaceId));

  return await getLinearIntegration(db, workspaceId);
};

export const setLinearLinkedTeam = async (
  db: DatabaseClient,
  workspaceId: string,
  team: { id: string; key: string | null; name: string }
) => {
  await db
    .update(linearIntegrations)
    .set({
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name,
      updatedAt: new Date(),
    })
    .where(eq(linearIntegrations.workspaceId, workspaceId));

  return await getLinearIntegration(db, workspaceId);
};

export const deleteLinearIntegration = async (
  db: DatabaseClient,
  workspaceId: string
) => {
  await db
    .delete(linearIntegrations)
    .where(eq(linearIntegrations.workspaceId, workspaceId));
};
