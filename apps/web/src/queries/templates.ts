import { fetchControllerJson } from "@/lib/controller-query";
import {
  listTemplatesPath,
  showTemplatePath,
} from "@/lib/generated/controller-routes";

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
  includePatterns?: string[];
  ignorePatterns?: string[];
  services?: Record<string, TemplateService>;
  env?: Record<string, string>;
  setup?: string[];
  prompts?: string[];
  teardown?: string[];
  agent?: {
    providerId: string;
    modelId?: string;
  };
};

export type Template = {
  id: string;
  label: string;
  type: string;
  configJson: TemplateConfig;
  includeDirectories?: string[];
};

export type Defaults = {
  templateId?: string;
  startMode?: "plan" | "build";
};

export type AgentDefaults = {
  providerId?: string;
  modelId?: string;
};

export type TemplatesResponse = {
  templates: Template[];
  defaults?: Defaults;
  agentDefaults?: AgentDefaults;
};

export const templateQueries = {
  all: (workspaceId: string) => ({
    queryKey: ["templates", workspaceId] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<TemplatesResponse> => {
      const data = await fetchControllerJson<Partial<TemplatesResponse>>(
        listTemplatesPath({ workspaceId }),
        "Failed to fetch templates"
      );
      const response = data as Partial<TemplatesResponse> | null;
      if (!(response && Array.isArray(response.templates))) {
        throw new Error("Invalid templates response from server");
      }
      return {
        templates: response.templates,
        defaults: response.defaults,
        agentDefaults: response.agentDefaults,
      };
    },
  }),

  detail: (workspaceId: string, id: string) => ({
    queryKey: ["templates", workspaceId, id] as const,
    queryFn: async (): Promise<Template> =>
      fetchControllerJson<Template>(
        showTemplatePath({ id }, { workspaceId }),
        "Template not found"
      ),
  }),
};
