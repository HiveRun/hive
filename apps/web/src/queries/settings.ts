import type { RJSFSchema } from "@rjsf/utils";

import { rpc } from "@/lib/rpc";

export type HiveService = {
  type: "process" | "docker" | "compose";
  run?: string;
  setup?: string[];
  cwd?: string;
  env?: Record<string, string>;
  readyTimeoutMs?: number;
  stop?: string;
  image?: string;
  command?: string;
  ports?: string[];
  volumes?: string[];
  file?: string;
  services?: string[];
};

export type HiveTemplateAgent = {
  providerId: string;
  modelId?: string;
  agentId?: string;
};

export type HiveTemplate = {
  id: string;
  label: string;
  type: "manual";
  services?: Record<string, HiveService>;
  env?: Record<string, string>;
  setup?: string[];
  prompts?: string[];
  agent?: HiveTemplateAgent;
  teardown?: string[];
  includePatterns?: string[];
  ignorePatterns?: string[];
};

export type HiveConfig = {
  opencode: {
    token?: string;
    defaultProvider: string;
    defaultModel?: string;
  };
  promptSources: string[];
  templates: Record<string, HiveTemplate>;
  defaults?: {
    templateId?: string;
  };
};

export type HiveSettingsResponse = {
  workspaceId: string;
  workspacePath: string;
  configPath: string;
  config: HiveConfig;
  schema: RJSFSchema;
};

type SettingsClient = {
  hive: {
    get: (input: { query?: { workspaceId?: string } }) => Promise<{
      data?: HiveSettingsResponse;
      error?: { message?: string };
    }>;
    put: (input: {
      query?: { workspaceId?: string };
      body: HiveConfig;
    }) => Promise<{
      data?: HiveSettingsResponse;
      error?: { message?: string };
    }>;
  };
};

const settingsClient = rpc.api.settings as unknown as SettingsClient;

export const hiveSettingsQueries = {
  detail: (workspaceId: string) => ({
    queryKey: ["hive-settings", workspaceId] as const,
    queryFn: async (): Promise<HiveSettingsResponse> => {
      const { data, error } = await settingsClient.hive.get({
        query: { workspaceId },
      });

      if (error || !data) {
        throw new Error("Failed to load hive settings");
      }

      return data;
    },
  }),
};

export const hiveSettingsMutations = {
  update: {
    mutationFn: async (input: { workspaceId: string; config: HiveConfig }) => {
      const { data, error } = await settingsClient.hive.put({
        query: { workspaceId: input.workspaceId },
        body: input.config,
      });

      if (error || !data) {
        const message = (error as { message?: string } | undefined)?.message;
        throw new Error(message ?? "Failed to save hive settings");
      }

      return data;
    },
  },
};
