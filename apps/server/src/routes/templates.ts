import { Elysia, t } from "elysia";
import { db } from "../db";
import { TemplateRepository } from "../repositories/templates";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

const templateRepo = new TemplateRepository(db);

export const templatesRoutes = new Elysia({ prefix: "/api/templates" })
  .get("/", async () => {
    const templates = await templateRepo.findAll();
    return { templates };
  })
  .get(
    "/:id",
    async ({ params, set }) => {
      const template = await templateRepo.findById(params.id);
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
        const template = await templateRepo.create({
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
      const deleted = await templateRepo.delete(params.id);
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
