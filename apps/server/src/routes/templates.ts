import { Elysia, t } from "elysia";
import { db as database } from "../db";
import { createTemplateQueries } from "../db/templates";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

const db = createTemplateQueries(database);

export const templatesRoutes = new Elysia({ prefix: "/api/templates" })
  .get("/", async () => {
    const templates = await db.findAll();
    return { templates };
  })
  .get(
    "/:id",
    async ({ params, set }) => {
      const template = await db.findById(params.id);
      if (!template) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Template not found" };
      }
      return template;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const template = await db.create({
          id: body.id,
          label: body.label,
          type: body.type,
          configJson: body.config,
        });
        return template;
      } catch (err) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            err instanceof Error ? err.message : "Failed to create template",
        };
      }
    },
    {
      body: t.Object({
        id: t.String(),
        label: t.String(),
        type: t.Literal("manual"),
        config: t.Any(),
      }),
    }
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const deleted = await db.delete(params.id);
      if (!deleted) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Template not found" };
      }
      return { success: true };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
