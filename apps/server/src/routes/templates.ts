import { Elysia } from "elysia";
import type { SyntheticConfig } from "../lib/schema";
import { templateIdParamSchema } from "../lib/zod-schemas";

export const templatesRoute = (config: SyntheticConfig) =>
  new Elysia({ prefix: "/api/templates" })
    .get("/", () =>
      config.templates.map((template) => ({
        id: template.id,
        label: template.label,
        summary: template.summary,
        type: template.type,
        servicesCount: template.services?.length || 0,
      }))
    )

    .get(
      "/:id",
      ({ params, set }) => {
        const template = config.templates.find((t) => t.id === params.id);
        if (!template) {
          set.status = 404;
          return { error: "Template not found" };
        }
        return template;
      },
      {
        params: templateIdParamSchema,
      }
    );
