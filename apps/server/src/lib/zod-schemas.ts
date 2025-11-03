import { z } from "zod";
import {
  agentStatusSchema,
  constructStatusSchema,
  envVarSchema,
  serviceStatusSchema,
} from "./schema";

// API validation schemas using our unified Zod schemas
export const createConstructRequestSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const updateConstructSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  status: constructStatusSchema.optional(),
  workspacePath: z.string().nullable().optional(),
  constructPath: z.string().nullable().optional(),
  completedAt: z.number().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

export const createAgentSessionSchema = z.object({
  id: z.string(),
  constructId: z.string(),
  sessionId: z.string(),
  provider: z.string(),
});

export const updateAgentSessionSchema = z.object({
  status: agentStatusSchema.optional(),
  errorMessage: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

export const createServiceSchema = z.object({
  id: z.string(),
  constructId: z.string(),
  serviceName: z.string(),
  serviceType: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  env: envVarSchema.optional(),
  ports: z.record(z.string(), z.number()).optional(),
  volumes: z.record(z.string(), z.string()).optional(),
});

export const updateServiceSchema = z.object({
  status: serviceStatusSchema.optional(),
  pid: z.number().nullable().optional(),
  containerId: z.string().nullable().optional(),
  healthStatus: z.string().nullable().optional(),
  lastHealthCheck: z.number().nullable().optional(),
  cpuUsage: z.string().nullable().optional(),
  memoryUsage: z.string().nullable().optional(),
  diskUsage: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

export const createPromptBundleSchema = z.object({
  id: z.string(),
  constructId: z.string(),
  content: z.string(),
  tokenEstimate: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updatePromptBundleSchema = z.object({
  content: z.string().optional(),
  tokenEstimate: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Agent schemas
export const sendMessageSchema = z.object({
  content: z.string().min(1),
});

// Common parameter schemas
export const constructIdParamSchema = z.object({
  constructId: z.string().min(1),
});

export const serviceIdParamSchema = z.object({
  serviceId: z.string().min(1),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.string().min(1),
});

export const templateIdParamSchema = z.object({
  id: z.string().min(1),
});
