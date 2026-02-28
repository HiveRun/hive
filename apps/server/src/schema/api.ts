import { t } from "elysia";

// Cell schemas
export const CellResponseSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.Union([t.String(), t.Null()]),
  templateId: t.String(),
  workspaceId: t.String(),
  workspaceRootPath: t.String(),
  workspacePath: t.String(),
  opencodeSessionId: t.Union([t.String(), t.Null()]),
  opencodeCommand: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  status: t.String(),
  lastSetupError: t.Optional(t.String()),
  branchName: t.Optional(t.String()),
  baseCommit: t.Optional(t.String()),
  setupLog: t.Optional(t.String()),
  setupLogPath: t.Optional(t.String()),
});

export const CellListResponseSchema = t.Object({
  cells: t.Array(CellResponseSchema),
});

export const CellServiceSchema = t.Object({
  id: t.String(),
  name: t.String(),
  type: t.String(),
  status: t.String(),
  port: t.Optional(t.Number()),
  url: t.Optional(t.String()),
  pid: t.Optional(t.Number()),
  command: t.String(),
  cwd: t.String(),
  logPath: t.Union([t.String(), t.Null()]),
  lastKnownError: t.Union([t.String(), t.Null()]),
  updatedAt: t.String(),
  env: t.Record(t.String(), t.String()),
  recentLogs: t.Union([t.String(), t.Null()]),
  totalLogLines: t.Union([t.Number(), t.Null()]),
  hasMoreLogs: t.Boolean(),
  processAlive: t.Optional(t.Boolean()),
  portReachable: t.Optional(t.Boolean()),
});

export const ServiceLogQuerySchema = t.Object({
  logLines: t.Optional(
    t.Number({
      minimum: 1,
      maximum: 2000,
      default: 200,
      description: "Number of log lines to return (1-2000, default: 200)",
    })
  ),
  logOffset: t.Optional(
    t.Number({
      minimum: 0,
      default: 0,
      description: "Number of lines to skip from the end (for pagination)",
    })
  ),
});

export const CellServiceListResponseSchema = t.Object({
  services: t.Array(CellServiceSchema),
});

export const CellTerminalSessionSchema = t.Object({
  sessionId: t.String(),
  cellId: t.String(),
  pid: t.Number(),
  cwd: t.String(),
  cols: t.Number(),
  rows: t.Number(),
  status: t.Union([t.Literal("running"), t.Literal("exited")]),
  exitCode: t.Union([t.Number(), t.Null()]),
  startedAt: t.String(),
});

export const CellTerminalInputSchema = t.Object({
  data: t.String({ minLength: 1 }),
});

export const CellTerminalResizeSchema = t.Object({
  cols: t.Number({ minimum: 20, maximum: 500 }),
  rows: t.Number({ minimum: 5, maximum: 200 }),
});

export const CellTerminalActionResponseSchema = t.Object({
  ok: t.Boolean(),
});

export const RuntimeTerminalSessionSchema = t.Object({
  sessionId: t.String(),
  pid: t.Number(),
  cwd: t.String(),
  cols: t.Number(),
  rows: t.Number(),
  status: t.Union([t.Literal("running"), t.Literal("exited")]),
  exitCode: t.Union([t.Number(), t.Null()]),
  startedAt: t.String(),
});

export const RuntimeTerminalResizeResponseSchema = t.Object({
  ok: t.Boolean(),
  session: RuntimeTerminalSessionSchema,
});

export const CellActivityEventSchema = t.Object({
  id: t.String(),
  cellId: t.String(),
  serviceId: t.Union([t.String(), t.Null()]),
  type: t.String(),
  source: t.Union([t.String(), t.Null()]),
  toolName: t.Union([t.String(), t.Null()]),
  metadata: t.Any(),
  createdAt: t.String(),
});

export const CellActivityEventListResponseSchema = t.Object({
  events: t.Array(CellActivityEventSchema),
  nextCursor: t.Union([t.String(), t.Null()]),
});

const CellTimingWorkflowSchema = t.Union([
  t.Literal("create"),
  t.Literal("delete"),
]);

const CellTimingStatusSchema = t.Union([t.Literal("ok"), t.Literal("error")]);

export const CellTimingStepSchema = t.Object({
  id: t.String(),
  cellId: t.String(),
  cellName: t.Union([t.String(), t.Null()]),
  workspaceId: t.Union([t.String(), t.Null()]),
  templateId: t.Union([t.String(), t.Null()]),
  runId: t.String(),
  workflow: CellTimingWorkflowSchema,
  step: t.String(),
  status: CellTimingStatusSchema,
  durationMs: t.Number(),
  attempt: t.Union([t.Number(), t.Null()]),
  error: t.Union([t.String(), t.Null()]),
  metadata: t.Any(),
  createdAt: t.String(),
});

export const CellTimingRunSchema = t.Object({
  runId: t.String(),
  cellId: t.String(),
  cellName: t.Union([t.String(), t.Null()]),
  workspaceId: t.Union([t.String(), t.Null()]),
  templateId: t.Union([t.String(), t.Null()]),
  workflow: CellTimingWorkflowSchema,
  status: CellTimingStatusSchema,
  startedAt: t.String(),
  finishedAt: t.String(),
  totalDurationMs: t.Number(),
  stepCount: t.Number(),
  attempt: t.Union([t.Number(), t.Null()]),
});

export const CellTimingListResponseSchema = t.Object({
  steps: t.Array(CellTimingStepSchema),
  runs: t.Array(CellTimingRunSchema),
});

const DiffStatusSchema = t.Union([
  t.Literal("modified"),
  t.Literal("added"),
  t.Literal("deleted"),
]);

export const DiffModeSchema = t.Union([
  t.Literal("workspace"),
  t.Literal("branch"),
]);

export const DiffSummaryModeSchema = t.Union([
  t.Literal("full"),
  t.Literal("none"),
]);

export const DiffQuerySchema = t.Object({
  mode: t.Optional(DiffModeSchema),
  files: t.Optional(t.String()),
  summary: t.Optional(DiffSummaryModeSchema),
});

export const DiffFileSummarySchema = t.Object({
  path: t.String(),
  status: DiffStatusSchema,
  additions: t.Number(),
  deletions: t.Number(),
});

export const DiffFileDetailSchema = t.Object({
  path: t.String(),
  status: DiffStatusSchema,
  additions: t.Number(),
  deletions: t.Number(),
  beforeContent: t.Optional(t.String()),
  afterContent: t.Optional(t.String()),
  patch: t.Optional(t.String()),
});

export const CellDiffResponseSchema = t.Object({
  mode: DiffModeSchema,
  baseCommit: t.Optional(t.Union([t.String(), t.Null()])),
  headCommit: t.Optional(t.Union([t.String(), t.Null()])),
  files: t.Array(DiffFileSummarySchema),
  details: t.Optional(t.Array(DiffFileDetailSchema)),
});

export const CreateCellSchema = t.Object({
  name: t.String({
    minLength: 1,
    maxLength: 255,
  }),
  description: t.Optional(
    t.String({
      maxLength: 1000,
    })
  ),
  templateId: t.String({
    minLength: 1,
  }),
  modelId: t.Optional(
    t.String({
      minLength: 1,
    })
  ),
  providerId: t.Optional(
    t.String({
      minLength: 1,
    })
  ),
  startMode: t.Optional(t.Union([t.Literal("plan"), t.Literal("build")])),
  workspaceId: t.String({
    minLength: 1,
  }),
});

export const DeleteCellsSchema = t.Object({
  ids: t.Array(
    t.String({
      minLength: 1,
    }),
    {
      minItems: 1,
    }
  ),
});

// Template schemas
export const TemplateResponseSchema = t.Object({
  id: t.String(),
  label: t.String(),
  type: t.String(),
  configJson: t.Any(),
  includeDirectories: t.Optional(t.Array(t.String())),
});

export const DefaultsResponseSchema = t.Object({
  templateId: t.Optional(t.String()),
  startMode: t.Optional(t.Union([t.Literal("plan"), t.Literal("build")])),
});

const AgentDefaultsSchema = t.Object({
  providerId: t.Optional(t.String()),
  modelId: t.Optional(t.String()),
});

export const TemplateListResponseSchema = t.Object({
  templates: t.Array(TemplateResponseSchema),
  defaults: t.Optional(DefaultsResponseSchema),
  agentDefaults: t.Optional(AgentDefaultsSchema),
});

export const AgentSessionSchema = t.Object({
  id: t.String(),
  cellId: t.String(),
  templateId: t.String(),
  provider: t.Optional(t.String()),
  status: t.String(),
  workspacePath: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String()),
  modelId: t.Optional(t.String()),
  modelProviderId: t.Optional(t.String()),
  startMode: t.Optional(t.Union([t.Literal("plan"), t.Literal("build")])),
  currentMode: t.Optional(t.Union([t.Literal("plan"), t.Literal("build")])),
  modeUpdatedAt: t.Optional(t.String()),
});

export const CreateAgentSessionSchema = t.Object({
  cellId: t.String(),
  force: t.Optional(t.Boolean()),
  modelId: t.Optional(t.String()),
  providerId: t.Optional(t.String()),
});

export const AgentMessageSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  role: t.String(),
  content: t.Union([t.String(), t.Null()]),
  state: t.String(),
  createdAt: t.String(),
  parts: t.Array(t.Any()), // Part[] from OpenCode SDK - complex union type
  parentId: t.Optional(t.Union([t.String(), t.Null()])),
  errorName: t.Optional(t.Union([t.String(), t.Null()])),
  errorMessage: t.Optional(t.Union([t.String(), t.Null()])),
});

export const AgentMessageListResponseSchema = t.Object({
  messages: t.Array(AgentMessageSchema),
});

export const AgentSessionByCellResponseSchema = t.Object({
  session: t.Union([AgentSessionSchema, t.Null()]),
});

export const SendAgentMessageSchema = t.Object({
  content: t.String({ minLength: 1 }),
});

export const RespondPermissionSchema = t.Object({
  response: t.Union([
    t.Literal("once"),
    t.Literal("always"),
    t.Literal("reject"),
  ]),
});

export const VoiceTranscriptionRequestSchema = t.Object({
  audioBase64: t.String({ minLength: 1 }),
  mimeType: t.Optional(t.String()),
  workspaceId: t.Optional(t.String({ minLength: 1 })),
});

export const WorkspaceDirectoryEntrySchema = t.Object({
  name: t.String(),
  path: t.String(),
  hasConfig: t.Boolean(),
});

export const WorkspaceBrowseResponseSchema = t.Object({
  path: t.String(),
  parentPath: t.Optional(t.Union([t.String(), t.Null()])),
  directories: t.Array(WorkspaceDirectoryEntrySchema),
});

export const VoiceTranscriptionResponseSchema = t.Object({
  text: t.String(),
  language: t.Union([t.String(), t.Null()]),
  durationInSeconds: t.Union([t.Number(), t.Null()]),
  segments: t.Array(
    t.Object({
      text: t.String(),
      start: t.Union([t.Number(), t.Null()]),
      end: t.Union([t.Number(), t.Null()]),
    })
  ),
});
