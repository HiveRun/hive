import { rpc } from "@/lib/rpc";

export type TemplateService = {
  type: string;
  run?: string;
  image?: string;
  file?: string;
  cwd?: string;
  env?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  setup?: string[];
  stop?: string;
  readyTimeoutMs?: number;
};

export type TemplateConfig = {
  services?: Record<string, TemplateService>;
  env?: Record<string, string>;
  setup?: string[];
  prompts?: string[];
  teardown?: string[];
};

export type Template = {
  id: string;
  label: string;
  type: string;
  configJson: TemplateConfig;
};

export type Defaults = {
  templateId?: string;
};

export type TemplatesResponse = {
  templates: Template[];
  defaults?: Defaults;
};

export const templateQueries = {
  all: (workspaceId: string) => ({
    queryKey: ["templates", workspaceId] as const,
    queryFn: async (): Promise<TemplatesResponse> => {
      const { data, error } = await rpc.api.templates.get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error("Failed to fetch templates");
      }
      if (!(data && Array.isArray(data.templates))) {
        throw new Error("Invalid templates response from server");
      }
      return {
        templates: data.templates,
        defaults: data.defaults,
      };
    },
  }),

  detail: (workspaceId: string, id: string) => ({
    queryKey: ["templates", workspaceId, id] as const,
    queryFn: async (): Promise<Template> => {
      const { data, error } = await rpc.api.templates({ id }).get({
        query: { workspaceId },
      });
      if (error) {
        throw new Error("Template not found");
      }
      return data;
    },
  }),
};
