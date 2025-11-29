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
  opencodeServerUrl: t.Union([t.String(), t.Null()]),
  opencodeServerPort: t.Union([t.Number(), t.Null()]),
  createdAt: t.String(),
  status: t.String(),
  lastSetupError: t.Optional(t.String()),
  branchName: t.Optional(t.String()),
  baseCommit: t.Optional(t.String()),
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
  pid: t.Optional(t.Number()),
  command: t.String(),
  cwd: t.String(),
  logPath: t.Union([t.String(), t.Null()]),
  lastKnownError: t.Union([t.String(), t.Null()]),
  updatedAt: t.String(),
  env: t.Record(t.String(), t.String()),
  recentLogs: t.Union([t.String(), t.Null()]),
  processAlive: t.Optional(t.Boolean()),
  portReachable: t.Optional(t.Boolean()),
});

export const CellServiceListResponseSchema = t.Object({
  services: t.Array(CellServiceSchema),
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
});

export const DefaultsResponseSchema = t.Object({
  templateId: t.Optional(t.String()),
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
  provider: t.String(),
  status: t.String(),
  workspacePath: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String()),
  modelId: t.Optional(t.String()),
  modelProviderId: t.Optional(t.String()),
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

export const VoiceModeSchema = t.Union([
  t.Literal("remote"),
  t.Literal("local"),
]);

export const VoiceConfigResponseSchema = t.Object({
  voice: t.Object({
    enabled: t.Boolean(),
    allowBrowserRecording: t.Boolean(),
    mode: t.Union([VoiceModeSchema, t.Null()]),
    provider: t.Union([t.String(), t.Null()]),
    model: t.Union([t.String(), t.Null()]),
    language: t.Union([t.String(), t.Null()]),
  }),
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
