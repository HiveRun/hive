import { t } from "elysia";

// Construct schemas
export const ConstructResponseSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.Union([t.String(), t.Null()]),
  templateId: t.String(),
  workspacePath: t.String(),
  createdAt: t.String(),
});

export const ConstructListResponseSchema = t.Object({
  constructs: t.Array(ConstructResponseSchema),
});

export const CreateConstructSchema = t.Object({
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
  useMock: t.Optional(t.Boolean()),
});

export const DeleteConstructsSchema = t.Object({
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

export const TemplateListResponseSchema = t.Object({
  templates: t.Array(TemplateResponseSchema),
});

export const AgentSessionSchema = t.Object({
  id: t.String(),
  constructId: t.String(),
  templateId: t.String(),
  provider: t.String(),
  status: t.String(),
  workspacePath: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String()),
});

export const CreateAgentSessionSchema = t.Object({
  constructId: t.String(),
  force: t.Optional(t.Boolean()),
  useMock: t.Optional(t.Boolean()),
});

export const AgentMessageSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  role: t.String(),
  content: t.Union([t.String(), t.Null()]),
  state: t.String(),
  createdAt: t.String(),
  parts: t.Array(t.Any()),
});

export const AgentMessageListResponseSchema = t.Object({
  messages: t.Array(AgentMessageSchema),
});

export const AgentSessionByConstructResponseSchema = t.Object({
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
