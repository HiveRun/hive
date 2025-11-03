import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-typebox";
import { t } from "elysia";
import { agentSessions, constructs, promptBundles, services } from "../db";
import {
  agentStatusSchema,
  constructStatusSchema,
  serviceStatusSchema,
} from "./schema";

// Generate TypeBox schemas from Drizzle tables
export const constructSelectSchema = createSelectSchema(constructs);
export const constructInsertSchema = createInsertSchema(constructs);
export const constructUpdateSchema = createUpdateSchema(constructs);

export const agentSessionSelectSchema = createSelectSchema(agentSessions);
export const agentSessionInsertSchema = createInsertSchema(agentSessions);
export const agentSessionUpdateSchema = createUpdateSchema(agentSessions);

export const serviceSelectSchema = createSelectSchema(services);
export const serviceInsertSchema = createInsertSchema(services);
export const serviceUpdateSchema = createUpdateSchema(services);

export const promptBundleSelectSchema = createSelectSchema(promptBundles);
export const promptBundleInsertSchema = createInsertSchema(promptBundles);
export const promptBundleUpdateSchema = createUpdateSchema(promptBundles);

// API validation schemas using our unified enums
export const createConstructRequestSchema = t.Object({
  templateId: t.String(),
  name: t.String(),
  description: t.Optional(t.String()),
  type: t.Optional(t.String()),
});

export const updateConstructSchema = t.Object({
  name: t.Optional(t.String()),
  description: t.Optional(t.Union([t.String(), t.Null()])),
  status: t.Optional(
    t.Union(constructStatusSchema.options.map((s) => t.Literal(s)))
  ),
  workspacePath: t.Optional(t.Union([t.String(), t.Null()])),
  constructPath: t.Optional(t.Union([t.String(), t.Null()])),
  completedAt: t.Optional(t.Union([t.Number(), t.Null()])),
  metadata: t.Optional(t.Union([t.Record(t.String(), t.Any()), t.Null()])),
});

export const createAgentSessionSchema = t.Object({
  id: t.String(),
  constructId: t.String(),
  sessionId: t.String(),
  provider: t.String(),
});

export const updateAgentSessionSchema = t.Object({
  status: t.Optional(
    t.Union(agentStatusSchema.options.map((s) => t.Literal(s)))
  ),
  errorMessage: t.Optional(t.String()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

export const createServiceSchema = t.Object({
  id: t.String(),
  constructId: t.String(),
  serviceName: t.String(),
  serviceType: t.Optional(t.String()),
  command: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
  env: t.Optional(t.Record(t.String(), t.String())),
  ports: t.Optional(t.Record(t.String(), t.Number())),
  volumes: t.Optional(t.Record(t.String(), t.String())),
});

export const updateServiceSchema = t.Object({
  status: t.Optional(
    t.Union(serviceStatusSchema.options.map((s) => t.Literal(s)))
  ),
  pid: t.Optional(t.Number()),
  containerId: t.Optional(t.String()),
  healthStatus: t.Optional(t.String()),
  lastHealthCheck: t.Optional(t.Number()),
  cpuUsage: t.Optional(t.String()),
  memoryUsage: t.Optional(t.String()),
  diskUsage: t.Optional(t.String()),
  errorMessage: t.Optional(t.String()),
  startedAt: t.Optional(t.Number()),
  stoppedAt: t.Optional(t.Number()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

export const createPromptBundleSchema = t.Object({
  id: t.String(),
  constructId: t.String(),
  content: t.String(),
  tokenEstimate: t.Number(),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

export const updatePromptBundleSchema = t.Object({
  content: t.Optional(t.String()),
  tokenEstimate: t.Optional(t.Number()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});
