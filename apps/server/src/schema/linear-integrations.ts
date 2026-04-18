import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const linearIntegrations = sqliteTable("workspace_linear_integrations", {
  workspaceId: text("workspace_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  tokenType: text("token_type"),
  scope: text("scope"),
  linearUserId: text("linear_user_id").notNull(),
  linearUserName: text("linear_user_name"),
  linearUserEmail: text("linear_user_email"),
  linearOrganizationId: text("linear_organization_id"),
  linearOrganizationName: text("linear_organization_name"),
  teamId: text("team_id"),
  teamKey: text("team_key"),
  teamName: text("team_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type LinearIntegration = typeof linearIntegrations.$inferSelect;
export type NewLinearIntegration = typeof linearIntegrations.$inferInsert;
