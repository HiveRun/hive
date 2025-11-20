import { Elysia, t } from "elysia";
import type { Template } from "../config/schema";
import {
  TemplateListResponseSchema,
  TemplateResponseSchema,
} from "../schema/api";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

function templateToResponse(_id: string, template: Template) {
  return {
    id: template.id,
    label: template.label,
    type: template.type,
    configJson: template,
  };
}

export const templatesRoutes = new Elysia({ prefix: "/api/templates" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/",
    async ({ query, set, getWorkspaceContext }) => {
      try {
        const workspaceContext = await getWorkspaceContext(query.workspaceId);
        const config = await workspaceContext.loadConfig();
        const templates = Object.entries(config.templates).map(
          ([id, template]) => templateToResponse(id, template)
        );
        return {
          templates,
          defaults: config.defaults,
        };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error ? error.message : "Failed to load templates",
        };
      }
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: TemplateListResponseSchema,
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/:id",
    async ({ params, query, set, getWorkspaceContext }) => {
      try {
        const workspaceContext = await getWorkspaceContext(query.workspaceId);
        const config = await workspaceContext.loadConfig();
        const template = config.templates[params.id];
        if (!template) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Template not found" };
        }
        return templateToResponse(params.id, template);
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error ? error.message : "Failed to load template",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: TemplateResponseSchema,
        400: t.Object({ message: t.String() }),
        404: t.Object({
          message: t.String(),
        }),
      },
    }
  );
