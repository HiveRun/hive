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

export const DefaultsResponseSchema = t.Object({
  templateId: t.Optional(t.String()),
});

export const TemplateListResponseSchema = t.Object({
  templates: t.Array(TemplateResponseSchema),
  defaults: t.Optional(DefaultsResponseSchema),
});
