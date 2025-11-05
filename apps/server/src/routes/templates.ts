import { Elysia, t } from "elysia";
import { loadConfig } from "../config/loader";
import type { SyntheticConfig, Template } from "../config/schema";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

async function getConfig(): Promise<SyntheticConfig> {
  const currentDir = process.cwd();
  const workspaceRoot = currentDir.includes("/apps/")
    ? currentDir.split("/apps/")[0] || currentDir
    : currentDir;

  return await loadConfig(workspaceRoot);
}

function templateToResponse(_id: string, template: Template) {
  return {
    id: template.id,
    label: template.label,
    type: template.type,
    configJson: template,
  };
}

export const templatesRoutes = new Elysia({ prefix: "/api/templates" })
  .get("/", async () => {
    const config = await getConfig();
    const templates = Object.entries(config.templates).map(([id, template]) =>
      templateToResponse(id, template)
    );
    return { templates };
  })
  .get(
    "/:id",
    async ({ params, set }) => {
      const config = await getConfig();
      const template = config.templates[params.id];
      if (!template) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Template not found" };
      }
      return templateToResponse(params.id, template);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
