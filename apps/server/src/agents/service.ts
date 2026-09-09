import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ModelInfo,
  OpenCodeClient,
  ProviderInfo,
  SessionInfo,
  SessionMessageInfo,
  V2Event,
} from "@opencode-ai/client";
import { isSessionNotFoundError } from "@opencode-ai/client";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { loadHiveConfig } from "../config/context";
import type { HiveConfig, Template } from "../config/schema";
import { db } from "../db";
import { cellProvisioningStates } from "../schema/cell-provisioning";
import { type Cell, cells } from "../schema/cells";
import { type CellService, cellServices } from "../schema/services";
import { runWithCellCleanupLock } from "../services/cell-cleanup-lock";
import { resolveCellEnvironment } from "../services/cell-environment";
import { requireCellAvailableForRuntime } from "../services/cell-runtime-guard";
import { publishAgentEvent } from "./events";
import {
  ensureHiveOpencodePlugin,
  ensureHiveToolConfig,
  resolveHiveServerUrl,
} from "./hive-opencode-tool";
import { loadEffectiveOpencodeDefaults } from "./opencode-config";
import { acquireSharedOpencodeClient } from "./opencode-server";
import type {
  AgentMessagePart,
  AgentMessageRecord,
  AgentMessageRole,
  AgentMessageState,
  AgentMode,
  AgentSessionRecord,
  AgentSessionStatus,
  AgentStreamEvent,
} from "./types";

const runtimeRegistry = new Map<string, RuntimeHandle>();
const cellSessionMap = new Map<string, string>();
const EVENT_STREAM_RECONNECT_DELAY_MS = 1000;
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
const HIVE_INSTRUCTIONS_RELATIVE_PATH = ".hive/instructions.md";
const HIVE_PLUGIN_ID = "hive.cell.v2.r1.tools-context-shell-permission";

type HiveSessionInstructionsService = Pick<
  CellService,
  "name" | "status" | "port" | "command" | "cwd"
>;

type HiveSessionInstructionsContext = {
  cell: Cell;
  template: Template;
  services: HiveSessionInstructionsService[];
  hiveUrl?: string;
};

function buildInstructionServices(
  template: Template,
  services: HiveSessionInstructionsService[]
): HiveSessionInstructionsService[] {
  if (services.length > 0) {
    return services;
  }

  return Object.entries(template.services ?? {}).map(([name, definition]) => {
    let command = "";
    let cwd = "";

    if (definition.type === "process") {
      command = definition.run;
      cwd = definition.cwd ?? "";
    } else if (
      "command" in definition &&
      typeof definition.command === "string"
    ) {
      command = definition.command;
    }

    return {
      name,
      status: "pending" as const,
      port: null,
      command,
      cwd,
    };
  });
}

function sanitizeServiceName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

function buildServiceUrl(port?: number | null): string | null {
  if (typeof port !== "number") {
    return null;
  }
  return `${DEFAULT_SERVICE_PROTOCOL}://${DEFAULT_SERVICE_HOST}:${port}`;
}

function buildHiveHeaderLines(
  context: HiveSessionInstructionsContext
): string[] {
  const { cell, template, hiveUrl } = context;
  const workspaceRootPath = cell.workspaceRootPath || cell.workspacePath;
  const taskDescription = cell.description?.trim()
    ? cell.description.trim()
    : "Follow the user instructions provided in this session.";

  const lines = [
    "# Hive Environment",
    "",
    "You are working in a Hive-managed development environment. This environment provides isolated, coordinated development sessions with automatic resource management.",
    "",
    "## Your Task",
    `**Instructions**: ${taskDescription}`,
    "",
    "## CRITICAL: Hive Operational Constraints",
    "You are running inside a Hive-managed environment. This is NOT a regular development setup.",
    "",
    "### What Hive Is",
    "- Agent coordination tool: Hive creates isolated development sessions for AI agents.",
    "- Resource management: automatic port allocation, service orchestration, cleanup.",
    `- Session isolation: your work is contained within agent ${cell.name} (${cell.id}).`,
    "- Multi-agent system: other agents may be running concurrently in separate environments.",
    "",
    "### CRITICAL: What You Must NOT Touch",
    `- Other agent resources: never modify files or services outside your worktree path: ${cell.workspacePath}.`,
    "- Port conflicts: only use your assigned ports. Other agents have their own allocations.",
    "- Service dependencies: do not start/stop services manually; Hive manages the lifecycle.",
    "- Database access: use only your environment's database connections and paths.",
    "- Git operations: work only in your assigned worktree, not the main repository.",
    "",
    "### Your Isolated Environment",
    `- Worktree Path: ${cell.workspacePath}`,
    `- Workspace Root: ${workspaceRootPath}`,
    `- Template: ${template.label} (${template.id})`,
    `- Status: ${cell.status}`,
  ];

  if (hiveUrl) {
    lines.push(`- Hive Dashboard: ${hiveUrl}`);
  }

  return lines;
}

function buildServiceLines(
  services: HiveSessionInstructionsService[]
): string[] {
  const lines = ["## Services"];

  if (services.length === 0) {
    lines.push("- No services registered for this cell.");
    return lines;
  }

  for (const service of services) {
    lines.push(`### ${service.name}`);
    lines.push(`- Status: ${service.status}`);
    if (service.port != null) {
      lines.push(`- Port: ${service.port}`);
      const serviceUrl = buildServiceUrl(service.port);
      if (serviceUrl) {
        lines.push(`- URL: ${serviceUrl}`);
      }
    } else {
      lines.push("- Port: pending");
    }
    lines.push("");
  }

  return lines;
}

function buildEnvironmentVariableLines(
  context: HiveSessionInstructionsContext
): string[] {
  const { cell, services } = context;
  const cellEnvironment = resolveCellEnvironment(cell.id, cell.workspacePath);

  const lines = [
    "## Hive-Generated Environment Variables",
    `- HIVE_CELL_ID=${cell.id}`,
    `- HIVE_CLI_BIN=${cellEnvironment.HIVE_CLI_BIN}`,
    `- HIVE_HOME=${cellEnvironment.HIVE_HOME}`,
    `- HIVE_BROWSE_ROOT=${cell.workspacePath}`,
    `- HIVE_CELL_RUNTIME_DIR=${cellEnvironment.HIVE_CELL_RUNTIME_DIR}`,
    `- HIVE_CELL_ARTIFACTS_DIR=${cellEnvironment.HIVE_CELL_ARTIFACTS_DIR}`,
    `- SERVICE_HOST=${DEFAULT_SERVICE_HOST}`,
    `- SERVICE_PROTOCOL=${DEFAULT_SERVICE_PROTOCOL}`,
    "",
  ];

  const servicesWithPorts = services.filter(
    (service) => typeof service.port === "number"
  );
  if (servicesWithPorts.length > 0) {
    lines.push("### Service Port Variables");
    for (const service of servicesWithPorts) {
      const portValue = String(service.port);
      const envName = `${sanitizeServiceName(service.name)}_PORT`;
      lines.push(`- ${envName}=${portValue}`);
    }
    lines.push("- PORT and SERVICE_PORT are set to the active service's port.");
    lines.push("- HIVE_SERVICE is set to the active service name.");
  } else if (services.length > 0) {
    lines.push("- Service ports will populate once services start.");
  }

  return lines;
}

function buildToolLines(): string[] {
  const lines = [
    "## Hive Tools",
    "",
    "You have tools to check service status, logs, and recover from common issues WITHOUT asking the user:",
    "",
    "- `hive_services` - CHECK THIS FIRST when debugging. Shows all services (running/stopped/error), ports, and recent logs.",
    "- `hive_service_logs` - Get more log history for a specific service. Use after hive_services identifies the problem service.",
    "- `hive_setup_logs` - Check setup/provisioning logs if services won't start or dependencies failed to install.",
    "- `hive_restart_service` - Restart ONE service (recommended default). Requires confirm=true.",
    "- `hive_restart_services` - Restart ALL services (higher blast radius). Requires confirm=true.",
    "- `hive_rerun_setup` - Re-run setup/provisioning commands if initialization failed. Requires confirm=true.",
    "",
    "WHEN TO USE:",
    "- Something not working? → Call hive_services to see service status and errors",
    "- Need more log context? → Call hive_service_logs with logLines=500 or higher",
    "- Services won't start? → Call hive_setup_logs to check if setup failed",
    "- One service stuck/crashed? → Call hive_restart_service (confirm=true) then re-check with hive_services",
    "- Whole cell wedged? → Call hive_restart_services (confirm=true) then re-check with hive_services",
    "- Setup failed / dependencies broken? → Fix workspace then call hive_rerun_setup (confirm=true)",
    "",
    "DO NOT ask the user for logs - use these tools to get them yourself.",
  ];
  return lines;
}

function renderHiveSessionInstructions(
  context: HiveSessionInstructionsContext
): string {
  return [
    ...buildHiveHeaderLines(context),
    "",
    ...buildServiceLines(context.services),
    "",
    ...buildEnvironmentVariableLines(context),
    "",
    ...buildToolLines(),
    "",
    "This environment context is generated by Hive for this agent session.",
  ].join("\n");
}

async function writeHiveSessionInstructions(
  context: HiveSessionInstructionsContext
): Promise<void> {
  const instructionsPath = join(
    context.cell.workspacePath,
    HIVE_INSTRUCTIONS_RELATIVE_PATH
  );
  await mkdir(join(context.cell.workspacePath, ".hive"), {
    recursive: true,
  });
  const content = renderHiveSessionInstructions(context);
  await writeFile(instructionsPath, content, "utf8");
}

type UserPromptPartInput =
  | { type: "text"; text: string }
  | {
      type: "file";
      mime: string;
      filename?: string;
      url: string;
    };

export type AgentPromptInput = {
  parts: UserPromptPartInput[];
};

function normalizePromptInput(
  input: string | AgentPromptInput
): AgentPromptInput {
  if (typeof input === "string") {
    return {
      parts: [{ type: "text", text: input }],
    };
  }

  return input;
}

function toOpencodePrompt(input: string | AgentPromptInput): {
  text: string;
  files?: Array<{ uri: string; name?: string }>;
} {
  const { parts } = normalizePromptInput(input);
  const text = parts
    .filter(
      (part): part is Extract<UserPromptPartInput, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n");
  const files = parts
    .filter(
      (part): part is Extract<UserPromptPartInput, { type: "file" }> =>
        part.type === "file"
    )
    .map((part) => ({
      uri: part.url,
      ...(part.filename ? { name: part.filename } : {}),
    }));

  return files.length > 0 ? { text, files } : { text };
}

type RuntimeHandle = {
  session: SessionInfo;
  cell: Cell;
  providerId?: string;
  modelId?: string;
  variant?: string;
  client: OpenCodeClient;
  abortController: AbortController;
  status: AgentSessionStatus;
  pendingInterrupt: boolean;
  preserveResumeOnInterrupt: boolean;
  startMode: AgentMode;
  currentMode: AgentMode;
  modeUpdatedAt: string;
  sendMessage: (input: string | AgentPromptInput) => Promise<void>;
  stop: (options?: StopRuntimeOptions) => Promise<void>;
};

type EnsureAgentSessionOptions = {
  force?: boolean;
  modelId?: string;
  providerId?: string;
  variant?: string;
  startMode?: AgentMode;
};

type StopRuntimeOptions = {
  deleteRemote?: boolean;
};

export type ProviderCatalog = {
  providers: ProviderInfo[];
  models: ModelInfo[];
  default: ModelInfo | null;
};

type AgentRuntimeDependencies = {
  db: typeof db;
  loadHiveConfig: (workspaceRoot?: string) => Promise<HiveConfig>;
  loadEffectiveOpencodeDefaults: typeof loadEffectiveOpencodeDefaults;
  publishAgentEvent: typeof publishAgentEvent;
  acquireOpencodeClient: () => Promise<OpenCodeClient>;
  ensureHiveOpencodePlugin: typeof ensureHiveOpencodePlugin;
  ensureHiveToolConfig: typeof ensureHiveToolConfig;
};

const agentRuntimeOverrides: Partial<AgentRuntimeDependencies> = {};

export const setAgentRuntimeDependencies = (
  overrides: Partial<AgentRuntimeDependencies>
) => {
  Object.assign(agentRuntimeOverrides, overrides);
};

export const resetAgentRuntimeDependencies = () => {
  for (const key of Object.keys(agentRuntimeOverrides)) {
    delete (agentRuntimeOverrides as Record<string, unknown>)[key];
  }
};

const getAgentRuntimeDependencies = (): AgentRuntimeDependencies => ({
  db: agentRuntimeOverrides.db ?? db,
  loadHiveConfig: agentRuntimeOverrides.loadHiveConfig ?? loadHiveConfig,
  loadEffectiveOpencodeDefaults:
    agentRuntimeOverrides.loadEffectiveOpencodeDefaults ??
    loadEffectiveOpencodeDefaults,
  publishAgentEvent:
    agentRuntimeOverrides.publishAgentEvent ?? publishAgentEvent,
  acquireOpencodeClient:
    agentRuntimeOverrides.acquireOpencodeClient ?? acquireSharedOpencodeClient,
  ensureHiveOpencodePlugin:
    agentRuntimeOverrides.ensureHiveOpencodePlugin ?? ensureHiveOpencodePlugin,
  ensureHiveToolConfig:
    agentRuntimeOverrides.ensureHiveToolConfig ?? ensureHiveToolConfig,
});

type TemplateAgentConfig = {
  providerId: string;
  modelId?: string;
  variant?: string;
};

function resolveTemplateAgentConfig(
  template: Template
): TemplateAgentConfig | undefined {
  if (!template.agent) {
    return;
  }

  const modelConfig = template.agent.model;
  const providerId = modelConfig?.providerId ?? template.agent.providerId;
  const modelId = modelConfig?.id ?? template.agent.modelId;
  const variant = modelConfig?.variant ?? template.agent.variant;

  if (!providerId) {
    return;
  }

  const agentConfig: TemplateAgentConfig = {
    providerId,
  };

  if (modelId) {
    agentConfig.modelId = modelId;
  }

  if (variant) {
    agentConfig.variant = variant;
  }

  return agentConfig;
}

function resolveProviderId(
  options: { providerId?: string } | undefined,
  agentConfig: TemplateAgentConfig | undefined,
  defaultOpencodeModel: { providerId?: string } | undefined,
  configDefaultProvider: string | undefined
): string | undefined {
  if (options?.providerId) {
    return options.providerId;
  }

  if (agentConfig?.providerId) {
    return agentConfig.providerId;
  }

  return defaultOpencodeModel?.providerId ?? configDefaultProvider;
}

type ResolveModelArgs = {
  options?: { modelId?: string };
  agentConfig?: TemplateAgentConfig;
  configDefaultModel?: string;
  defaultOpencodeModel?: { providerId?: string; modelId?: string };
  resolvedProviderId?: string;
};

function resolveModelId({
  options,
  agentConfig,
  configDefaultModel,
  defaultOpencodeModel,
  resolvedProviderId,
}: ResolveModelArgs): string | undefined {
  if (options?.modelId) {
    return options.modelId;
  }

  if (agentConfig?.modelId) {
    return agentConfig.modelId;
  }

  const opencodeMatchesProvider =
    defaultOpencodeModel?.modelId &&
    (!defaultOpencodeModel.providerId ||
      defaultOpencodeModel.providerId === resolvedProviderId)
      ? defaultOpencodeModel.modelId
      : undefined;

  if (opencodeMatchesProvider) {
    return opencodeMatchesProvider;
  }

  return configDefaultModel;
}

type ModelSelectionCandidate = {
  providerId?: string;
  modelId?: string;
  variant?: string;
};

type ModelSelectionSource =
  | "override"
  | "template"
  | "opencode-default"
  | "config-default"
  | "provider-fallback";

type ResolvedModelSelection = ModelSelectionCandidate & {
  source: ModelSelectionSource;
};

function pickResolvedSelection(args: {
  overrideModel: ModelSelectionCandidate | null;
  agentModel: ModelSelectionCandidate | null;
  validOpencodeDefault: ModelSelectionCandidate | null;
  configFallback: ModelSelectionCandidate | null;
  providerFallback: ModelSelectionCandidate | null;
}): ResolvedModelSelection {
  if (args.overrideModel) {
    return { source: "override", ...args.overrideModel };
  }

  if (args.agentModel) {
    return { source: "template", ...args.agentModel };
  }

  if (args.validOpencodeDefault) {
    return { source: "opencode-default", ...args.validOpencodeDefault };
  }

  if (args.configFallback) {
    return { source: "config-default", ...args.configFallback };
  }

  return { source: "provider-fallback", ...(args.providerFallback ?? {}) };
}

function normalizeAgentMode(value: string | undefined): AgentMode | undefined {
  if (value === "plan" || value === "build") {
    return value;
  }
  return;
}

async function loadProvisioningAgentOptions(args: {
  runtimeDb: AgentRuntimeDependencies["db"];
  cellId: string;
}): Promise<{
  modelSelection?: ModelSelectionCandidate;
  startMode?: AgentMode;
}> {
  const [provisioningState] = await args.runtimeDb
    .select({
      modelId: cellProvisioningStates.modelIdOverride,
      providerId: cellProvisioningStates.providerIdOverride,
      variant: cellProvisioningStates.variantOverride,
      startMode: cellProvisioningStates.startMode,
    })
    .from(cellProvisioningStates)
    .where(eq(cellProvisioningStates.cellId, args.cellId))
    .limit(1);
  const startMode = normalizeAgentMode(
    provisioningState?.startMode ?? undefined
  );

  return {
    ...(provisioningState?.modelId
      ? {
          modelSelection: {
            modelId: provisioningState.modelId,
            ...(provisioningState.providerId
              ? { providerId: provisioningState.providerId }
              : {}),
            ...(provisioningState.variant
              ? { variant: provisioningState.variant }
              : {}),
          },
        }
      : {}),
    ...(startMode ? { startMode } : {}),
  };
}

function resolveConfigDefaultMode(args: {
  hiveConfig: HiveConfig;
  effectiveOpencodeDefaults: Awaited<
    ReturnType<typeof loadEffectiveOpencodeDefaults>
  >;
}): AgentMode {
  const explicit = normalizeAgentMode(args.hiveConfig.opencode?.defaultMode);
  if (explicit) {
    return explicit;
  }

  if (args.effectiveOpencodeDefaults.startMode) {
    const fromAgent = normalizeAgentMode(
      args.effectiveOpencodeDefaults.startMode
    );
    if (fromAgent) {
      return fromAgent;
    }
  }

  return "plan";
}

async function shouldApplyProvisioningModelOverride(args: {
  cell: Cell;
  force: boolean;
  acquireOpencodeClient: AgentRuntimeDependencies["acquireOpencodeClient"];
}): Promise<boolean> {
  if (args.force || !args.cell.opencodeSessionId) {
    return true;
  }

  try {
    const client = await args.acquireOpencodeClient();
    const existingSession = await getRemoteSession(
      client,
      args.cell.opencodeSessionId
    );

    return existingSession === null;
  } catch {
    return false;
  }
}

function resolveExplicitModelSelection(options?: {
  modelId?: string;
  providerId?: string;
  variant?: string;
}): ModelSelectionCandidate | undefined {
  if (!(options?.modelId || options?.providerId || options?.variant)) {
    return;
  }

  return {
    ...(options?.modelId ? { modelId: options.modelId } : {}),
    ...(options?.providerId ? { providerId: options.providerId } : {}),
    ...(options?.variant ? { variant: options.variant } : {}),
  };
}

async function resolveRuntimeModelSelectionOptions(args: {
  cell: Cell;
  options?: EnsureAgentSessionOptions;
  persistedModelSelection?: ModelSelectionCandidate;
  deps: AgentRuntimeDependencies;
}): Promise<ModelSelectionCandidate | undefined> {
  const explicitModelSelection = resolveExplicitModelSelection(args.options);
  if (explicitModelSelection) {
    return explicitModelSelection;
  }

  if (!args.persistedModelSelection) {
    return;
  }

  const shouldApplyPersistedModelOverride =
    await shouldApplyProvisioningModelOverride({
      cell: args.cell,
      force: args.options?.force ?? false,
      acquireOpencodeClient: args.deps.acquireOpencodeClient,
    });

  if (!shouldApplyPersistedModelOverride) {
    return;
  }

  return args.persistedModelSelection;
}

function findProviderById(
  providers: ProviderInfo[],
  providerId: string | undefined
): ProviderInfo | undefined {
  if (!providerId) {
    return;
  }

  return providers.find((provider) => provider.id === providerId);
}

function formatListPreview(items: string[], limit = 10): string {
  if (items.length <= limit) {
    return items.join(", ");
  }

  const preview = items.slice(0, limit).join(", ");
  return `${preview}, ... (+${items.length - limit} more)`;
}

function listProviderModelIdentifiers(
  models: ModelInfo[],
  providerId: string
): string[] {
  const unique = new Set<string>();
  for (const model of models) {
    if (model.enabled && model.providerID === providerId) {
      unique.add(model.id);
      unique.add(model.modelID);
    }
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function listProviderModelVariantIdentifiers(args: {
  models: ModelInfo[];
  providerId: string;
  modelId: string;
}): string[] {
  const model = findModel(args.models, args.providerId, args.modelId);
  return (model?.variants ?? [])
    .map((variant) => variant.id)
    .sort((a, b) => a.localeCompare(b));
}

function buildInvalidModelOverrideMessage(args: {
  modelId: string;
  providerId?: string;
  providers: ProviderInfo[];
  models: ModelInfo[];
}): string {
  const { modelId, providerId, providers, models } = args;

  if (providerId) {
    const provider = findProviderById(providers, providerId);
    if (!provider) {
      const providerIds = providers.map((entry) => entry.id).sort();
      const availableProviders = providerIds.length
        ? formatListPreview(providerIds)
        : "none";
      return `Selected model override is invalid: provider "${providerId}" was not found. Available providers: ${availableProviders}. Refresh the model catalog and try again.`;
    }

    const availableModels = listProviderModelIdentifiers(models, provider.id);
    const availableModelSummary = availableModels.length
      ? formatListPreview(availableModels)
      : "none";
    return `Selected model override is invalid: model "${modelId}" is unavailable for provider "${providerId}". Available models: ${availableModelSummary}. Refresh the model catalog and try again.`;
  }

  const providerIds = providers.map((entry) => entry.id).sort();
  const providerSummary = providerIds.length
    ? formatListPreview(providerIds)
    : "none";
  return `Selected model override is invalid: model "${modelId}" was not found in the provider catalog. Available providers: ${providerSummary}.`;
}

function buildInvalidVariantOverrideMessage(args: {
  providerId: string;
  modelId: string;
  variant: string;
  providers: ProviderInfo[];
  models: ModelInfo[];
}): string {
  const provider = findProviderById(args.providers, args.providerId);
  if (!(provider && findModel(args.models, args.providerId, args.modelId))) {
    return `Selected model variant override is invalid: model "${args.modelId}" is unavailable for provider "${args.providerId}".`;
  }

  const availableVariants = listProviderModelVariantIdentifiers({
    models: args.models,
    providerId: provider.id,
    modelId: args.modelId,
  });
  const variantSummary = availableVariants.length
    ? formatListPreview(availableVariants)
    : "none";

  return `Selected model variant override is invalid: variant "${args.variant}" is unavailable for model "${args.modelId}" on provider "${args.providerId}". Available variants: ${variantSummary}. Refresh the model catalog and try again.`;
}

function findModel(
  models: ModelInfo[],
  providerId: string,
  modelId: string
): ModelInfo | undefined {
  return models.find(
    (model) =>
      model.enabled &&
      model.providerID === providerId &&
      (model.id === modelId || model.modelID === modelId)
  );
}

function resolveProviderVariantMatch(args: {
  model: ModelInfo;
  candidateVariant: string | undefined;
}): string | undefined | null {
  if (!args.candidateVariant) {
    return;
  }

  if (
    args.model.variants.some((variant) => variant.id === args.candidateVariant)
  ) {
    return args.candidateVariant;
  }

  return null;
}

function resolveCandidateModelForProvider(args: {
  provider: ProviderInfo;
  models: ModelInfo[];
  candidate: ModelSelectionCandidate;
}): ModelSelectionCandidate | null {
  if (!args.candidate.modelId) {
    return null;
  }

  const model = findModel(
    args.models,
    args.provider.id,
    args.candidate.modelId
  );
  if (!model) {
    return null;
  }

  const resolvedVariant = resolveProviderVariantMatch({
    model,
    candidateVariant: args.candidate.variant,
  });
  if (args.candidate.variant && !resolvedVariant) {
    return null;
  }

  return {
    providerId: args.provider.id,
    modelId: model.id,
    ...(resolvedVariant ? { variant: resolvedVariant } : {}),
  };
}

function resolveCandidateModel({
  candidate,
  providers,
  models,
}: {
  candidate: ModelSelectionCandidate;
  providers: ProviderInfo[];
  models: ModelInfo[];
}): ModelSelectionCandidate | null {
  if (!candidate.modelId) {
    return null;
  }

  if (candidate.providerId) {
    const provider = findProviderById(providers, candidate.providerId);
    if (provider) {
      return resolveCandidateModelForProvider({ provider, models, candidate });
    }
    return null;
  }

  for (const provider of providers) {
    const resolved = resolveCandidateModelForProvider({
      provider,
      models,
      candidate,
    });
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

/** Falls back to the first provider's default or first enabled model. */
function resolveModelFallback({
  providers,
  models,
  defaultModel,
}: {
  providers: ProviderInfo[];
  models: ModelInfo[];
  defaultModel: ModelInfo | null;
}): ModelSelectionCandidate | null {
  const [provider] = providers;
  if (!provider) {
    return null;
  }

  if (defaultModel?.enabled && defaultModel.providerID === provider.id) {
    return { providerId: provider.id, modelId: defaultModel.id };
  }

  const firstModel = models.find(
    (model) => model.enabled && model.providerID === provider.id
  );
  return firstModel
    ? { providerId: provider.id, modelId: firstModel.id }
    : null;
}

type ModelSelectionContext = {
  options?: { modelId?: string; providerId?: string; variant?: string };
  agentConfig?: TemplateAgentConfig;
  defaultOpencodeModel?: {
    providerId?: string;
    modelId?: string;
    variant?: string;
  };
  configDefaultProvider?: string;
  configDefaultModel?: string;
  providers: ProviderInfo[];
  models: ModelInfo[];
  defaultModel: ModelInfo | null;
};

function resolveModelSelection({
  options,
  agentConfig,
  defaultOpencodeModel,
  configDefaultProvider,
  configDefaultModel,
  providers,
  models,
  defaultModel,
}: ModelSelectionContext): ResolvedModelSelection {
  const overrideModel = resolveCandidateModel({
    candidate: {
      providerId: options?.providerId,
      modelId: options?.modelId,
      variant: options?.variant,
    },
    providers,
    models,
  });

  if (options?.modelId && !overrideModel) {
    const resolvedProviderId =
      options.providerId ??
      resolveCandidateModel({
        candidate: {
          providerId: options.providerId,
          modelId: options.modelId,
        },
        providers,
        models,
      })?.providerId;

    if (options.variant && resolvedProviderId) {
      const resolvedModelId =
        resolveCandidateModel({
          candidate: {
            providerId: resolvedProviderId,
            modelId: options.modelId,
          },
          providers,
          models,
        })?.modelId ?? options.modelId;

      throw new Error(
        buildInvalidVariantOverrideMessage({
          providerId: resolvedProviderId,
          modelId: resolvedModelId,
          variant: options.variant,
          providers,
          models,
        })
      );
    }

    throw new Error(
      buildInvalidModelOverrideMessage({
        modelId: options.modelId,
        providerId: options.providerId,
        providers,
        models,
      })
    );
  }

  const agentModel = resolveCandidateModel({
    candidate: {
      providerId: agentConfig?.providerId,
      modelId: agentConfig?.modelId,
      variant: agentConfig?.variant,
    },
    providers,
    models,
  });

  const validOpencodeDefault = resolveCandidateModel({
    candidate: {
      providerId: defaultOpencodeModel?.providerId,
      modelId: defaultOpencodeModel?.modelId,
      variant: defaultOpencodeModel?.variant,
    },
    providers,
    models,
  });

  const configFallback = resolveCandidateModel({
    candidate: {
      providerId: configDefaultProvider,
      modelId: configDefaultModel,
    },
    providers,
    models,
  });

  const providerFallback = resolveModelFallback({
    providers,
    models,
    defaultModel,
  });

  const resolvedSelection = pickResolvedSelection({
    overrideModel,
    agentModel,
    validOpencodeDefault,
    configFallback,
    providerFallback,
  });
  const effectiveAgentConfig =
    agentConfig?.modelId && !agentModel ? undefined : agentConfig;

  const providerId =
    resolvedSelection.providerId ??
    resolveProviderId(
      options,
      effectiveAgentConfig,
      validOpencodeDefault ?? undefined,
      configDefaultProvider
    );

  const modelId =
    resolvedSelection.modelId ??
    resolveModelId({
      options,
      agentConfig: effectiveAgentConfig,
      configDefaultModel,
      defaultOpencodeModel: validOpencodeDefault ?? undefined,
      resolvedProviderId: providerId,
    });

  return {
    source: resolvedSelection.source,
    providerId,
    modelId,
    ...(resolvedSelection.variant
      ? { variant: resolvedSelection.variant }
      : {}),
  };
}

export async function ensureAgentSession(
  cellId: string,
  options?: EnsureAgentSessionOptions
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForCell(cellId, options);
  return toSessionRecord(runtime);
}

export async function fetchAgentSession(
  sessionId: string
): Promise<AgentSessionRecord | null> {
  const existing = runtimeRegistry.get(sessionId);
  if (existing) {
    return await fetchSynchronizedSessionRecord(async () => existing);
  }

  const cell = await getCellBySessionId(sessionId);
  if (!cell) {
    return null;
  }
  return await fetchSynchronizedSessionRecord(() =>
    ensureRuntimeForCell(cell.id, { force: false })
  );
}

export async function fetchAgentSessionForCell(
  cellId: string
): Promise<AgentSessionRecord | null> {
  const cell = await getCellById(cellId);
  if (!cell || cell.status === "deleting") {
    return null;
  }
  return await fetchSynchronizedSessionRecord(() =>
    ensureRuntimeForCell(cellId, { force: false })
  );
}

async function fetchSynchronizedSessionRecord(
  resolveRuntime: () => Promise<RuntimeHandle>
): Promise<AgentSessionRecord | null> {
  const runtime = await resolveRuntime();
  await synchronizeRuntimeSessionInfo(runtime);
  await synchronizeRuntimeStatus(runtime);
  return toSessionRecord(runtime);
}

async function synchronizeRuntimeSessionInfo(
  runtime: RuntimeHandle
): Promise<void> {
  const session = await runtime.client.session.get({
    sessionID: runtime.session.id,
  });
  runtime.session = session;
  if (session.model) {
    runtime.providerId = session.model.providerID;
    runtime.modelId = session.model.id;
    runtime.variant = session.model.variant;
  }
  const mode = normalizeAgentMode(session.agent);
  if (mode) {
    setRuntimeMode(runtime, mode);
  }
}

export async function fetchAgentMessages(
  sessionId: string
): Promise<AgentMessageRecord[]> {
  const runtime = await ensureRuntimeForSession(sessionId);
  return loadRemoteMessages(runtime);
}

export async function updateAgentSessionModel(
  sessionId: string,
  model: { modelId: string; providerId?: string; variant?: string }
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForSession(sessionId);
  const nextProviderId = model.providerId ?? runtime.providerId;
  if (!nextProviderId) {
    throw new Error("A provider is required to select an OpenCode model");
  }
  await runtime.client.session.switchModel({
    sessionID: runtime.session.id,
    model: {
      id: model.modelId,
      providerID: nextProviderId,
      ...(model.variant ? { variant: model.variant } : {}),
    },
  });
  runtime.providerId = nextProviderId;
  runtime.modelId = model.modelId;
  runtime.variant = model.variant;
  runtime.session.model = {
    providerID: nextProviderId,
    id: model.modelId,
    ...(model.variant ? { variant: model.variant } : {}),
  };
  return toSessionRecord(runtime);
}

export async function sendAgentMessage(
  sessionId: string,
  input: string | AgentPromptInput
): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  await runtime.sendMessage(input);
}

export async function interruptAgentSession(sessionId: string): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  runtime.pendingInterrupt = true;
  try {
    await runtime.client.session.interrupt({ sessionID: runtime.session.id });
  } catch (error) {
    runtime.pendingInterrupt = false;
    throw error;
  }

  await applyRuntimeStatus(runtime, "awaiting_input");
}

export async function stopAgentSession(
  sessionId: string,
  options: StopRuntimeOptions = { deleteRemote: false }
): Promise<void> {
  const runtime = runtimeRegistry.get(sessionId);
  if (!runtime) {
    return;
  }

  await runtime.stop(options);
  runtimeRegistry.delete(sessionId);
  cellSessionMap.delete(runtime.cell.id);
}

export async function closeAgentSession(cellId: string): Promise<void> {
  const sessionId = cellSessionMap.get(cellId);
  if (sessionId) {
    const hadRuntime = runtimeRegistry.has(sessionId);
    await stopAgentSession(sessionId, { deleteRemote: true });
    if (hadRuntime) {
      return;
    }
  }

  const cell = await getCellById(cellId);
  if (!cell?.opencodeSessionId) {
    return;
  }

  await deleteRemoteOpencodeSession({
    sessionId: cell.opencodeSessionId,
  });
  cellSessionMap.delete(cellId);
}

export async function closeAllAgentSessions(
  options: StopRuntimeOptions = { deleteRemote: false }
): Promise<void> {
  const sessionIds = Array.from(runtimeRegistry.keys());

  for (const sessionId of sessionIds) {
    await stopAgentSession(sessionId, options);
  }
}

export async function prepareSessionsForServiceReplacement(
  client: OpenCodeClient
): Promise<void> {
  await prepareOwnedActiveSessions(client);
}

export async function prepareAgentSessionsForShutdown(): Promise<void> {
  const { acquireOpencodeClient } = getAgentRuntimeDependencies();
  await prepareOwnedActiveSessions(await acquireOpencodeClient(), {
    preserveRuntimeResume: true,
  });
}

async function prepareOwnedActiveSessions(
  client: OpenCodeClient,
  options?: { preserveRuntimeResume?: boolean }
): Promise<void> {
  const activeSessionIds = Object.keys(await client.session.active());
  if (activeSessionIds.length === 0) {
    return;
  }

  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const ownedSessions = await runtimeDb
    .select({ id: cells.id, sessionId: cells.opencodeSessionId })
    .from(cells)
    .where(inArray(cells.opencodeSessionId, activeSessionIds));

  if (ownedSessions.length === 0) {
    return;
  }

  await runtimeDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: true })
    .where(
      inArray(
        cells.id,
        ownedSessions.map((cell) => cell.id)
      )
    );

  updateOwnedRuntimeResumeState(
    ownedSessions,
    options?.preserveRuntimeResume === true
  );

  const failures: unknown[] = [];
  for (const ownedSession of ownedSessions) {
    const failure = await interruptOwnedSession(client, ownedSession);
    if (failure) {
      failures.push(failure);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Failed to interrupt all active Hive OpenCode sessions"
    );
  }
}

function updateOwnedRuntimeResumeState(
  ownedSessions: Array<{ id: string; sessionId: string | null }>,
  preserveResumeOnInterrupt: boolean
): void {
  for (const { sessionId } of ownedSessions) {
    const runtime = sessionId ? runtimeRegistry.get(sessionId) : undefined;
    if (runtime) {
      runtime.cell.resumeAgentSessionOnStartup = true;
      runtime.preserveResumeOnInterrupt = preserveResumeOnInterrupt;
    }
  }
}

async function interruptOwnedSession(
  client: OpenCodeClient,
  ownedSession: { id: string; sessionId: string | null }
): Promise<Error | null> {
  if (!ownedSession.sessionId) {
    return null;
  }
  try {
    await client.session.interrupt({ sessionID: ownedSession.sessionId });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(
      `Failed to interrupt OpenCode session ${ownedSession.sessionId} for cell ${ownedSession.id}: ${message}`,
      { cause: error }
    );
  }
}

export async function resumeAgentSessionsOnStartup(): Promise<void> {
  const { db: runtimeDb, acquireOpencodeClient } =
    getAgentRuntimeDependencies();
  const persistedCells = await runtimeDb
    .select()
    .from(cells)
    .where(isNotNull(cells.opencodeSessionId));

  if (persistedCells.length === 0) {
    return;
  }

  const client = await acquireOpencodeClient();
  const activeSessions = await client.session.active();

  for (const cell of persistedCells) {
    try {
      await recoverPersistedCell(cell, client, activeSessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[agent] Failed to resume agent session for ${cell.id}: ${message}\n`
      );
    }
  }
}

async function recoverPersistedCell(
  cell: Cell,
  client: OpenCodeClient,
  activeSessions: Awaited<ReturnType<OpenCodeClient["session"]["active"]>>
): Promise<void> {
  const persistedSessionId = cell.opencodeSessionId;
  if (!persistedSessionId) {
    return;
  }

  let liveState: RuntimeLiveState | undefined;
  if (!cell.resumeAgentSessionOnStartup) {
    liveState = await loadRuntimeLiveState(
      client,
      persistedSessionId,
      activeSessions
    );
    if (!hasRecoverableLiveState(liveState)) {
      return;
    }
  }

  const runtime = await ensureRuntimeForCell(cell.id, { force: false });
  liveState ??= await loadRuntimeLiveState(
    runtime.client,
    runtime.session.id,
    activeSessions
  );
  if (hasRecoverableLiveState(liveState)) {
    await applyRuntimeLiveState(runtime, liveState);
    return;
  }

  if (shouldResumeRuntime(runtime)) {
    await assertHivePluginReady(runtime.client, runtime.cell.workspacePath);
    await runtime.client.session.prompt({
      sessionID: runtime.session.id,
      text: "",
      resume: true,
    });
    await applyRuntimeStatus(runtime, "working");
    return;
  }

  const { db: runtimeDb } = getAgentRuntimeDependencies();
  await runtimeDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: false })
    .where(eq(cells.id, cell.id));
  runtime.cell.resumeAgentSessionOnStartup = false;
}

async function assertHivePluginReady(
  client: OpenCodeClient,
  directory: string
): Promise<void> {
  const plugins = await client.plugin.list({
    location: { directory },
  });
  const plugin = plugins.data.find(
    (candidate) => candidate.id === HIVE_PLUGIN_ID
  );
  if (!plugin) {
    throw new Error(
      `Required OpenCode plugin ${HIVE_PLUGIN_ID} is not registered for ${directory}`
    );
  }
  if (plugin.state.status === "failed") {
    throw new Error(
      `Required OpenCode plugin ${HIVE_PLUGIN_ID} failed: ${plugin.state.error}`
    );
  }
}

function shouldResumeRuntime(runtime: RuntimeHandle): boolean {
  return (
    runtime.cell.resumeAgentSessionOnStartup &&
    runtime.session.outcome !== "succeeded" &&
    runtime.session.outcome !== "failed"
  );
}

export type AgentRuntimeService = {
  readonly ensureAgentSession: (
    cellId: string,
    options?: EnsureAgentSessionOptions
  ) => Promise<AgentSessionRecord>;
  readonly fetchAgentSession: (
    sessionId: string
  ) => Promise<AgentSessionRecord | null>;
  readonly fetchAgentSessionForCell: (
    cellId: string
  ) => Promise<AgentSessionRecord | null>;
  readonly fetchAgentMessages: (
    sessionId: string
  ) => Promise<AgentMessageRecord[]>;
  readonly updateAgentSessionModel: (
    sessionId: string,
    model: { modelId: string; providerId?: string; variant?: string }
  ) => Promise<AgentSessionRecord>;
  readonly sendAgentMessage: (
    sessionId: string,
    input: string | AgentPromptInput
  ) => Promise<void>;
  readonly interruptAgentSession: (sessionId: string) => Promise<void>;
  readonly stopAgentSession: (
    sessionId: string,
    options?: StopRuntimeOptions
  ) => Promise<void>;
  readonly closeAgentSession: (cellId: string) => Promise<void>;
  readonly closeAllAgentSessions: (
    options?: StopRuntimeOptions
  ) => Promise<void>;
  readonly respondAgentPermission: (
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject"
  ) => Promise<void>;
  readonly fetchProviderCatalogForWorkspace: (
    workspaceRootPath: string
  ) => Promise<ProviderCatalog>;
};

export const agentRuntimeService: AgentRuntimeService = {
  ensureAgentSession,
  fetchAgentSession,
  fetchAgentSessionForCell,
  fetchAgentMessages,
  updateAgentSessionModel,
  sendAgentMessage,
  interruptAgentSession,
  stopAgentSession,
  closeAgentSession,
  closeAllAgentSessions,
  respondAgentPermission,
  fetchProviderCatalogForWorkspace,
};

export async function respondAgentPermission(
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject"
): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  await runtime.client.permission.reply({
    sessionID: sessionId,
    requestID: permissionId,
    reply: response,
  });
}

export async function ensureRuntimeForSession(
  sessionId: string
): Promise<RuntimeHandle> {
  const existing = runtimeRegistry.get(sessionId);
  if (existing) {
    return existing;
  }

  const cell = await getCellBySessionId(sessionId);
  if (!cell) {
    throw new Error("Agent session not found");
  }

  const runtime = await ensureRuntimeForCell(cell.id, {
    force: false,
  });
  return runtime;
}

function getExistingRuntimeForCell(
  cellId: string,
  options?: { force?: boolean }
): RuntimeHandle | null {
  const currentSessionId = cellSessionMap.get(cellId);
  if (!currentSessionId || options?.force) {
    return null;
  }

  return runtimeRegistry.get(currentSessionId) ?? null;
}

function resolveTemplateForCell(hiveConfig: HiveConfig, templateId: string) {
  const template = hiveConfig.templates[templateId];
  if (!template) {
    throw new Error("Cell template configuration not found");
  }
  return template;
}

async function hydrateInstructionsForCell(
  deps: AgentRuntimeDependencies,
  cell: Cell
): Promise<{
  hiveConfig: HiveConfig;
  template: Template;
  services: HiveSessionInstructionsService[];
}> {
  const workspaceRootPath = cell.workspaceRootPath || cell.workspacePath;
  const hiveConfig = await deps.loadHiveConfig(workspaceRootPath);
  const template = resolveTemplateForCell(hiveConfig, cell.templateId);

  const serviceRows = await deps.db
    .select()
    .from(cellServices)
    .where(eq(cellServices.cellId, cell.id));
  const services = buildInstructionServices(template, serviceRows);

  await writeHiveSessionInstructions({
    cell,
    template,
    services,
    hiveUrl: process.env.HIVE_URL,
  });

  return { hiveConfig, template, services };
}

async function ensureRuntimeForCell(
  cellId: string,
  options?: EnsureAgentSessionOptions
): Promise<RuntimeHandle> {
  return await runWithCellCleanupLock(cellId, async () =>
    ensureRuntimeForCellUnlocked(cellId, options)
  );
}

async function ensureRuntimeForCellUnlocked(
  cellId: string,
  options?: EnsureAgentSessionOptions
): Promise<RuntimeHandle> {
  const deps = getAgentRuntimeDependencies();
  const cell = await requireCellAvailableForRuntime(deps.db, cellId);
  await deps.ensureHiveOpencodePlugin(cell.workspacePath);
  await deps.ensureHiveToolConfig(cell.workspacePath, {
    cellId: cell.id,
    hiveUrl: resolveHiveServerUrl(),
  });
  const activeRuntime = getExistingRuntimeForCell(cellId, options);
  if (activeRuntime) {
    await hydrateInstructionsForCell(deps, activeRuntime.cell);
    return activeRuntime;
  }

  const workspaceRootPath = cell.workspaceRootPath || cell.workspacePath;

  const { hiveConfig, template } = await hydrateInstructionsForCell(deps, cell);

  const agentConfig = resolveTemplateAgentConfig(template);
  const effectiveOpencodeDefaults =
    await deps.loadEffectiveOpencodeDefaults(workspaceRootPath);
  const defaultOpencodeModel = effectiveOpencodeDefaults.defaultModel;
  const configDefaultProvider = hiveConfig.opencode?.defaultProvider;
  const configDefaultModel = hiveConfig.opencode?.defaultModel;
  const configDefaultMode = resolveConfigDefaultMode({
    hiveConfig,
    effectiveOpencodeDefaults,
  });

  const providerCatalog =
    await fetchProviderCatalogForWorkspace(workspaceRootPath);

  const provisioningOptions = await loadProvisioningAgentOptions({
    runtimeDb: deps.db,
    cellId,
  });

  const selectionOptions = await resolveRuntimeModelSelectionOptions({
    cell,
    options,
    persistedModelSelection: provisioningOptions.modelSelection,
    deps,
  });

  const startMode =
    options?.startMode ?? provisioningOptions.startMode ?? configDefaultMode;

  const selection = resolveModelSelection({
    options: selectionOptions,
    agentConfig,
    defaultOpencodeModel,
    configDefaultProvider,
    configDefaultModel,
    providers: providerCatalog.providers,
    models: providerCatalog.models,
    defaultModel: providerCatalog.default,
  });
  const shouldDeferToOpencodeDefault = selection.source === "opencode-default";

  const requestedProviderId = shouldDeferToOpencodeDefault
    ? undefined
    : selection.providerId;
  const requestedModelId = shouldDeferToOpencodeDefault
    ? undefined
    : selection.modelId;
  const requestedVariant = shouldDeferToOpencodeDefault
    ? undefined
    : selection.variant;

  const {
    runtime,
    created: createdSession,
    abortController,
  } = await startOpencodeRuntime({
    cell,
    providerId: requestedProviderId,
    modelId: requestedModelId,
    variant: requestedVariant,
    startMode,
    force: options?.force ?? false,
    deps,
  });

  let restoredModel: Awaited<ReturnType<typeof resolveSessionModelPreference>> =
    null;
  await startEventStream({
    runtime,
    abortController,
    beforeInitialReconciliation: () => {
      restoredModel = resolveSessionModelPreference(runtime);
      if (restoredModel && !options?.modelId) {
        runtime.providerId = restoredModel.providerId;
        runtime.modelId = restoredModel.modelId;
        runtime.variant = restoredModel.variant;
      }

      const restoredMode = resolveSessionModePreference(runtime);
      if (restoredMode) {
        setRuntimeMode(runtime, restoredMode);
      }
    },
  });

  if (
    createdSession &&
    shouldSeedModelPreference({
      selectionOptions,
      runtime,
      restoredModel,
    })
  ) {
    await seedSessionModelPreference(runtime);
  }

  cellSessionMap.set(cell.id, runtime.session.id);
  runtimeRegistry.set(runtime.session.id, runtime);

  return runtime;
}

function shouldSeedModelPreference(args: {
  selectionOptions: ModelSelectionCandidate | undefined;
  runtime: RuntimeHandle;
  restoredModel: {
    providerId: string;
    modelId: string;
    variant?: string;
  } | null;
}): boolean {
  if (!(args.selectionOptions?.modelId && args.runtime.modelId)) {
    return false;
  }

  if (!args.restoredModel) {
    return true;
  }

  return !(
    args.restoredModel.modelId === args.runtime.modelId &&
    args.restoredModel.providerId === args.runtime.providerId &&
    args.restoredModel.variant === args.runtime.variant
  );
}

export async function fetchProviderCatalogForWorkspace(
  workspaceRootPath: string
): Promise<ProviderCatalog> {
  const { acquireOpencodeClient: acquireClient } =
    getAgentRuntimeDependencies();
  const client = await acquireClient();

  try {
    const location = { location: { directory: workspaceRootPath } };
    const [providerResult, modelResult, defaultResult] = await Promise.all([
      client.provider.list(location),
      client.model.list(location),
      client.model.default(location),
    ]);
    return {
      providers: providerResult.data,
      models: modelResult.data,
      default: defaultResult.data,
    };
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: server-side diagnostic logging
    console.error("[opencode] provider catalog error", {
      workspaceRootPath,
      error,
    });

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to fetch provider catalog from OpenCode";
    throw new Error(message);
  }
}

type StartRuntimeArgs = {
  cell: Cell;
  providerId?: string;
  modelId?: string;
  variant?: string;
  startMode: AgentMode;
  force: boolean;
  deps: AgentRuntimeDependencies;
};

async function startOpencodeRuntime({
  cell,
  providerId,
  modelId,
  variant,
  startMode,
  force,
  deps,
}: StartRuntimeArgs): Promise<{
  runtime: RuntimeHandle;
  created: boolean;
  abortController: AbortController;
}> {
  const client = await deps.acquireOpencodeClient();
  const { session, created } = await resolveOpencodeSession({
    client,
    cell,
    providerId,
    modelId,
    variant,
    startMode,
    force,
  });

  if (created) {
    session.agent = startMode;
  }

  if (created || cell.opencodeSessionId !== session.id) {
    const { db: runtimeDb } = getAgentRuntimeDependencies();
    await runtimeDb
      .update(cells)
      .set({ opencodeSessionId: session.id })
      .where(eq(cells.id, cell.id));
    cell.opencodeSessionId = session.id;
  }

  const abortController = new AbortController();

  const runtime: RuntimeHandle = {
    session,
    cell,
    providerId,
    modelId,
    variant,
    client,
    abortController,
    status: "awaiting_input",
    pendingInterrupt: false,
    preserveResumeOnInterrupt: false,
    startMode,
    currentMode: startMode,
    modeUpdatedAt: new Date().toISOString(),
    async sendMessage(input) {
      runtime.pendingInterrupt = false;
      await assertHivePluginReady(runtime.client, runtime.cell.workspacePath);
      await applyRuntimeStatus(runtime, "working");

      try {
        await runtime.client.session.prompt({
          sessionID: session.id,
          ...toOpencodePrompt(input),
        });
      } catch (error) {
        if (runtime.pendingInterrupt && isMessageAbortedError(error)) {
          runtime.pendingInterrupt = false;
          await applyRuntimeStatus(runtime, "awaiting_input");
          return;
        }

        const errorMessage = getRpcErrorMessage(error, "Agent prompt failed");
        await applyRuntimeStatus(runtime, "error", errorMessage);
        throw new Error(errorMessage);
      }

      runtime.pendingInterrupt = false;
    },
    async stop(options = { deleteRemote: false }) {
      abortController.abort();
      if (options.deleteRemote === true) {
        await deleteRemoteOpencodeSession({
          sessionId: session.id,
          client: runtime.client,
        });
      }
      await applyRuntimeStatus(runtime, "completed", undefined, {
        persist: options.deleteRemote === true,
      });
    },
  };

  setRuntimeStatus(runtime, "awaiting_input");

  return { runtime, created, abortController };
}

type ResolveSessionArgs = {
  client: OpenCodeClient;
  cell: Cell;
  providerId?: string;
  modelId?: string;
  variant?: string;
  startMode: AgentMode;
  force: boolean;
};

async function resolveOpencodeSession({
  client,
  cell,
  providerId,
  modelId,
  variant,
  startMode,
  force,
}: ResolveSessionArgs): Promise<{ session: SessionInfo; created: boolean }> {
  if (!force && cell.opencodeSessionId) {
    const existing = await getRemoteSession(client, cell.opencodeSessionId);
    if (existing) {
      return { session: existing, created: false };
    }
  }

  const created = await client.session.create({
    title: cell.name,
    agent: startMode,
    ...(providerId && modelId
      ? {
          model: {
            id: modelId,
            providerID: providerId,
            ...(variant ? { variant } : {}),
          },
        }
      : {}),
    location: { directory: cell.workspacePath },
  });

  return { session: created, created: true };
}

async function getRemoteSession(
  client: OpenCodeClient,
  sessionId: string
): Promise<SessionInfo | null> {
  try {
    return await client.session.get({ sessionID: sessionId });
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function startEventStream({
  runtime,
  abortController,
  beforeInitialReconciliation,
}: {
  runtime: RuntimeHandle;
  abortController: AbortController;
  beforeInitialReconciliation: () => Promise<void> | void;
}): Promise<void> {
  const initialReconciliation = Promise.withResolvers<void>();
  runEventStream({
    runtime,
    abortController,
    beforeInitialReconciliation,
    resolveInitialReconciliation: initialReconciliation.resolve,
    rejectInitialReconciliation: initialReconciliation.reject,
  }).catch(initialReconciliation.reject);
  return initialReconciliation.promise;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reconnect startup must distinguish initial reconciliation from later failures
async function runEventStream({
  runtime,
  abortController,
  beforeInitialReconciliation,
  resolveInitialReconciliation,
  rejectInitialReconciliation,
}: {
  runtime: RuntimeHandle;
  abortController: AbortController;
  beforeInitialReconciliation: () => Promise<void> | void;
  resolveInitialReconciliation: () => void;
  rejectInitialReconciliation: (error: unknown) => void;
}): Promise<void> {
  let reconciled = false;
  const markReconciled = () => {
    if (reconciled) {
      return;
    }
    reconciled = true;
    resolveInitialReconciliation();
  };
  while (!abortController.signal.aborted) {
    try {
      await consumeEventStream(
        runtime,
        abortController.signal,
        markReconciled,
        reconciled ? undefined : beforeInitialReconciliation
      );
    } catch (error) {
      if (!reconciled) {
        abortController.abort();
        rejectInitialReconciliation(error);
        return;
      }
      if (abortController.signal.aborted) {
        return;
      }
    }

    try {
      await delay(EVENT_STREAM_RECONNECT_DELAY_MS, undefined, {
        signal: abortController.signal,
      });
      runtime.client =
        await getAgentRuntimeDependencies().acquireOpencodeClient();
    } catch {
      if (abortController.signal.aborted) {
        return;
      }
    }
  }
}

async function consumeEventStream(
  runtime: RuntimeHandle,
  signal: AbortSignal,
  onReconciled: () => void,
  beforeReconcile?: () => Promise<void> | void
): Promise<void> {
  const events = runtime.client.event.subscribe({ signal });
  const iterator = events[Symbol.asyncIterator]();
  let nextEvent = iterator.next();
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  await beforeReconcile?.();
  await synchronizeRuntimeStatus(runtime);
  onReconciled();

  while (true) {
    const next = await nextEvent;
    if (next.done) {
      return;
    }
    nextEvent = iterator.next();
    const event = next.value;
    const eventSessionId = getEventSessionId(event);
    if (eventSessionId !== runtime.session.id) {
      continue;
    }

    updateRuntimeModeFromEvent(runtime, event);
    updateRuntimeModelFromEvent(runtime, event);
    const inputRequiredEvent = resolveInputRequiredEvent(event);
    if (inputRequiredEvent) {
      publish(runtime.session.id, inputRequiredEvent);
    }
    await updateRuntimeStatusFromEvent(runtime, event);
  }
}

function toRuntimeFilePart(
  file: NonNullable<
    Extract<SessionMessageInfo, { type: "user" }>["files"]
  >[number]
): AgentMessagePart {
  const url =
    file.source.type === "uri"
      ? file.source.uri
      : `data:${file.mime};base64,${file.data}`;
  return {
    type: "file",
    mime: file.mime,
    ...(file.name ? { filename: file.name } : {}),
    url,
  };
}

function getMessageParts(message: SessionMessageInfo): AgentMessagePart[] {
  if (message.type === "user") {
    const parts: AgentMessagePart[] = message.text
      ? [{ type: "text", text: message.text }]
      : [];
    parts.push(...(message.files ?? []).map(toRuntimeFilePart));
    return parts;
  }

  if (message.type === "assistant") {
    return message.content.map((part) => ({ ...part }));
  }

  const text = getOpencodeSystemMessageText(message);
  return text ? [{ type: "text", text }] : [];
}

type OpencodeSystemMessage = Exclude<
  SessionMessageInfo,
  { type: "user" } | { type: "assistant" }
>;

function getOpencodeSystemMessageText(message: OpencodeSystemMessage): string {
  switch (message.type) {
    case "synthetic":
    case "system":
    case "skill":
      return message.text;
    case "shell":
      return message.output?.output ?? message.command;
    case "compaction":
      return message.status === "failed" ? "" : message.summary;
    default:
      return "";
  }
}

function resolveSessionModelPreference(
  runtime: RuntimeHandle
): { providerId: string; modelId: string; variant?: string } | null {
  if (!runtime.session.model) {
    return null;
  }

  return {
    providerId: runtime.session.model.providerID,
    modelId: runtime.session.model.id,
    ...(runtime.session.model.variant
      ? { variant: runtime.session.model.variant }
      : {}),
  };
}

function resolveSessionModePreference(
  runtime: RuntimeHandle
): AgentMode | null {
  return normalizeAgentMode(runtime.session.agent) ?? null;
}

async function* iterateRemoteMessages(
  runtime: RuntimeHandle,
  options: { limit: number; order: "asc" | "desc" }
): AsyncGenerator<SessionMessageInfo> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const seenMessages = new Set<string>();
  do {
    const page = await runtime.client.message.list({
      sessionID: runtime.session.id,
      limit: options.limit,
      ...(cursor ? { cursor } : { order: options.order }),
    });
    for (const message of page.data) {
      if (!seenMessages.has(message.id)) {
        seenMessages.add(message.id);
        yield message;
      }
    }
    const nextCursor = page.cursor.next ?? undefined;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error(
        `OpenCode message pagination repeated cursor ${JSON.stringify(nextCursor)}`
      );
    }
    if (nextCursor) {
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);
}

async function synchronizeRuntimeStatus(runtime: RuntimeHandle): Promise<void> {
  const liveState = await loadRuntimeLiveState(
    runtime.client,
    runtime.session.id
  );
  if (hasRecoverableLiveState(liveState)) {
    await applyRuntimeLiveState(runtime, liveState);
    return;
  }

  if (runtime.session.outcome === "failed") {
    await applyRuntimeStatus(runtime, "error");
    return;
  }
  if (
    runtime.session.outcome === "succeeded" ||
    (runtime.session.outcome === "interrupted" &&
      !runtime.cell.resumeAgentSessionOnStartup)
  ) {
    await applyRuntimeStatus(runtime, "awaiting_input");
  }
}

type RuntimeLiveState = {
  active: boolean;
  inbox: Awaited<ReturnType<OpenCodeClient["session"]["inbox"]["list"]>>;
  permissions: Awaited<ReturnType<OpenCodeClient["permission"]["list"]>>;
  forms: Awaited<ReturnType<OpenCodeClient["form"]["list"]>>;
};

type PendingRuntimeInputs = Pick<RuntimeLiveState, "permissions" | "forms">;
type InputRequiredEvent = Extract<AgentStreamEvent, { type: "input_required" }>;

async function loadPendingRuntimeInputs(
  client: OpenCodeClient,
  sessionId: string
): Promise<PendingRuntimeInputs> {
  const [permissions, forms] = await Promise.all([
    client.permission.list({ sessionID: sessionId }),
    client.form.list({ sessionID: sessionId }),
  ]);
  return { permissions, forms };
}

async function loadRuntimeLiveState(
  client: OpenCodeClient,
  sessionId: string,
  activeSessions?: Awaited<ReturnType<OpenCodeClient["session"]["active"]>>
): Promise<RuntimeLiveState> {
  const [active, inbox, pendingInputs] = await Promise.all([
    activeSessions ?? client.session.active(),
    client.session.inbox.list({ sessionID: sessionId }),
    loadPendingRuntimeInputs(client, sessionId),
  ]);
  return {
    active: Boolean(active[sessionId]),
    inbox,
    ...pendingInputs,
  };
}

function hasRecoverableLiveState(state: RuntimeLiveState): boolean {
  return (
    state.active ||
    state.inbox.length > 0 ||
    state.permissions.length > 0 ||
    state.forms.length > 0
  );
}

async function applyRuntimeLiveState(
  runtime: RuntimeHandle,
  state: RuntimeLiveState
): Promise<void> {
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  for (const event of createPendingInputEvents(state)) {
    publish(runtime.session.id, event);
  }

  if (state.permissions.length > 0 || state.forms.length > 0) {
    await applyRuntimeStatus(runtime, "awaiting_input", undefined, {
      persist: !runtime.preserveResumeOnInterrupt,
    });
    return;
  }
  await applyRuntimeStatus(runtime, "working");
}

function createPendingInputEvents(
  state: PendingRuntimeInputs
): InputRequiredEvent[] {
  return [
    ...state.permissions.map(
      (permission): InputRequiredEvent => ({
        type: "input_required",
        sessionId: permission.sessionID,
        permissionId: permission.id,
        title: permission.action,
        kind: "permission",
      })
    ),
    ...state.forms.map(
      (form): InputRequiredEvent => ({
        type: "input_required",
        sessionId: form.sessionID,
        permissionId: form.id,
        title: form.title,
        kind: "question",
      })
    ),
  ];
}

function resolveInputRequiredEvent(
  event: V2Event
): InputRequiredEvent | undefined {
  if (event.type === "permission.asked") {
    return {
      type: "input_required",
      sessionId: event.data.sessionID,
      permissionId: event.data.id,
      title: event.data.action,
      kind: "permission",
    };
  }

  if (event.type === "form.created") {
    return {
      type: "input_required",
      sessionId: event.data.form.sessionID,
      permissionId: event.data.form.id,
      title: event.data.form.title,
      kind: "question",
    };
  }
}

export async function fetchPendingAgentInputEvents(
  sessionId: string
): Promise<InputRequiredEvent[]> {
  const runtime = runtimeRegistry.get(sessionId);
  if (!runtime) {
    throw new Error("Agent session not found");
  }
  return createPendingInputEvents(
    await loadPendingRuntimeInputs(runtime.client, sessionId)
  );
}

async function seedSessionModelPreference(
  runtime: RuntimeHandle
): Promise<void> {
  if (!(runtime.providerId && runtime.modelId)) {
    return;
  }

  try {
    await runtime.client.session.switchModel({
      sessionID: runtime.session.id,
      model: {
        providerID: runtime.providerId,
        id: runtime.modelId,
        ...(runtime.variant ? { variant: runtime.variant } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logModelSeedWarning(runtime, message);
  }
}

function logModelSeedWarning(runtime: RuntimeHandle, message: string) {
  // biome-ignore lint/suspicious/noConsole: startup warning for non-fatal model seeding errors
  console.warn("[agent] Failed to seed session model preference", {
    cellId: runtime.cell.id,
    sessionId: runtime.session.id,
    providerId: runtime.providerId,
    modelId: runtime.modelId,
    variant: runtime.variant,
    message,
  });
}

function getEventSessionId(event: V2Event): string | undefined {
  switch (event.type) {
    case "session.status":
    case "session.idle":
    case "session.execution.started":
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.agent.selected":
    case "session.model.selected":
    case "session.step.started":
    case "permission.asked":
    case "permission.replied":
    case "form.replied":
    case "form.cancelled":
      return event.data.sessionID;
    case "form.created":
      return event.data.form.sessionID;
    default:
      return;
  }
}

async function updateRuntimeStatusFromEvent(
  runtime: RuntimeHandle,
  event: V2Event
): Promise<void> {
  if (event.type === "session.execution.started") {
    runtime.session.outcome = undefined;
  } else if (event.type === "session.execution.succeeded") {
    runtime.session.outcome = "succeeded";
  } else if (event.type === "session.execution.failed") {
    runtime.session.outcome = "failed";
  } else if (event.type === "session.execution.interrupted") {
    runtime.session.outcome = "interrupted";
  }

  if (
    event.type === "session.execution.failed" &&
    runtime.pendingInterrupt &&
    isMessageAbortedError(event.data.error)
  ) {
    runtime.pendingInterrupt = false;
    await applyRuntimeStatus(runtime, "awaiting_input");
    return;
  }

  if (
    runtime.pendingInterrupt &&
    (event.type === "session.idle" ||
      event.type === "session.execution.interrupted")
  ) {
    runtime.pendingInterrupt = false;
  }

  const update = resolveRuntimeStatusFromEvent(event);
  if (!update) {
    return;
  }

  await applyRuntimeStatus(runtime, update.status, update.error, {
    persist: !runtime.preserveResumeOnInterrupt,
  });
}

export function resolveRuntimeStatusFromEvent(
  event: V2Event
): { status: AgentSessionStatus; error?: string } | null {
  switch (event.type) {
    case "session.execution.failed":
      return { status: "error", error: event.data.error.message };
    case "session.idle":
    case "session.execution.succeeded":
    case "session.execution.interrupted":
    case "form.cancelled":
      return { status: "awaiting_input" };
    case "session.status":
      return {
        status:
          event.data.status.type === "idle" ? "awaiting_input" : "working",
      };
    case "permission.asked":
    case "form.created":
      return { status: "awaiting_input" };
    case "permission.replied":
    case "form.replied":
    case "session.execution.started":
    case "session.step.started":
      return { status: "working" };
    default:
      return null;
  }
}

async function loadRemoteMessages(
  runtime: RuntimeHandle
): Promise<AgentMessageRecord[]> {
  const messages: SessionMessageInfo[] = [];
  for await (const message of iterateRemoteMessages(runtime, {
    limit: 200,
    order: "asc",
  })) {
    messages.push(message);
  }

  return messages.map((message) =>
    serializeMessage(runtime.session.id, message)
  );
}

function serializeMessage(
  sessionId: string,
  message: SessionMessageInfo
): AgentMessageRecord {
  const parts = getMessageParts(message);
  const contentText = extractTextFromParts(parts);
  const role: AgentMessageRole =
    message.type === "user" || message.type === "assistant"
      ? message.type
      : "system";
  const error = getMessageError(message);
  const isAborted = isMessageAbortedError(error);

  return {
    id: message.id,
    sessionId,
    role,
    content: contentText.length ? contentText : null,
    parts,
    state: determineMessageState(message, error),
    createdAt: new Date(message.time.created).toISOString(),
    parentId: null,
    errorName: isAborted ? (error?.type ?? null) : null,
    errorMessage: isAborted ? (error?.message ?? null) : null,
  };
}

function getMessageError(message: SessionMessageInfo) {
  if (message.type === "assistant") {
    return message.error;
  }
  return message.type === "compaction" && message.status === "failed"
    ? message.error
    : undefined;
}

function extractTextFromParts(parts: AgentMessagePart[] | undefined): string {
  return (parts ?? [])
    .map((part) =>
      (part.type === "text" || part.type === "reasoning") &&
      typeof part.text === "string"
        ? part.text
        : ""
    )
    .filter(Boolean)
    .join("\n");
}

function determineMessageState(
  message: SessionMessageInfo,
  error: ReturnType<typeof getMessageError>
): AgentMessageState {
  if (error || (message.type === "compaction" && message.status === "failed")) {
    return "error";
  }
  if (message.type === "assistant" && !message.time.completed) {
    return "streaming";
  }
  return "completed";
}

function toSessionRecord(runtime: RuntimeHandle): AgentSessionRecord {
  const modelFields =
    runtime.modelId === undefined
      ? {}
      : {
          modelId: runtime.modelId,
          modelProviderId: runtime.providerId,
          ...(runtime.variant ? { modelVariant: runtime.variant } : {}),
        };

  return {
    id: runtime.session.id,
    cellId: runtime.cell.id,
    templateId: runtime.cell.templateId,
    provider: runtime.providerId,
    status: runtime.status,
    workspacePath: runtime.cell.workspacePath,
    createdAt: new Date(runtime.session.time.created).toISOString(),
    updatedAt: new Date(runtime.session.time.updated).toISOString(),
    ...modelFields,
    startMode: runtime.startMode,
    currentMode: runtime.currentMode,
    modeUpdatedAt: runtime.modeUpdatedAt,
  };
}

function setRuntimeStatus(
  runtime: RuntimeHandle,
  status: AgentSessionStatus,
  error?: string
) {
  runtime.status = status;
  const statusEvent =
    error === undefined
      ? { type: "status" as const, status }
      : { type: "status" as const, status, error };
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  publish(runtime.session.id, statusEvent);
}

async function applyRuntimeStatus(
  runtime: RuntimeHandle,
  status: AgentSessionStatus,
  error?: string,
  options?: { persist?: boolean }
): Promise<void> {
  setRuntimeStatus(runtime, status, error);

  if (options?.persist === false) {
    return;
  }

  try {
    await persistRuntimeResumeState(runtime, status);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // biome-ignore lint/suspicious/noConsole: non-fatal persistence failures should not break the runtime event loop
    console.warn("[agent] Failed to persist runtime resume state", {
      cellId: runtime.cell.id,
      sessionId: runtime.session.id,
      status,
      message,
    });
  }
}

async function persistRuntimeResumeState(
  runtime: RuntimeHandle,
  status: AgentSessionStatus
): Promise<void> {
  const shouldResume = status === "working" && !runtime.pendingInterrupt;
  if (runtime.cell.resumeAgentSessionOnStartup === shouldResume) {
    return;
  }

  const { db: runtimeDb } = getAgentRuntimeDependencies();
  await runtimeDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: shouldResume })
    .where(eq(cells.id, runtime.cell.id));
  runtime.cell.resumeAgentSessionOnStartup = shouldResume;
}

export function resolveRuntimeModeFromEvent(
  event: V2Event
): AgentMode | undefined {
  switch (event.type) {
    case "session.agent.selected":
      return normalizeAgentMode(event.data.agent);
    case "session.step.started":
      return normalizeAgentMode(event.data.agent);
    default:
      return;
  }
}

function setRuntimeMode(runtime: RuntimeHandle, mode: AgentMode): void {
  if (runtime.currentMode === mode) {
    return;
  }

  runtime.currentMode = mode;
  runtime.modeUpdatedAt = new Date().toISOString();
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  publish(runtime.session.id, {
    type: "mode",
    startMode: runtime.startMode,
    currentMode: runtime.currentMode,
    modeUpdatedAt: runtime.modeUpdatedAt,
  });
}

function updateRuntimeModeFromEvent(
  runtime: RuntimeHandle,
  event: V2Event
): void {
  const nextMode = resolveRuntimeModeFromEvent(event);
  if (!nextMode) {
    return;
  }

  setRuntimeMode(runtime, nextMode);
  runtime.session.agent = nextMode;
}

function updateRuntimeModelFromEvent(
  runtime: RuntimeHandle,
  event: V2Event
): void {
  const model =
    event.type === "session.model.selected" ||
    event.type === "session.step.started"
      ? event.data.model
      : undefined;
  if (!model) {
    return;
  }
  runtime.providerId = model.providerID;
  runtime.modelId = model.id;
  runtime.variant = model.variant;
  runtime.session.model = model;
}

function isMessageAbortedError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "MessageAbortedError") ||
    (typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "MessageAbortedError")
  );
}

function getRpcErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : fallback;
}

async function deleteRemoteOpencodeSession(args: {
  sessionId: string;
  client?: OpenCodeClient;
}): Promise<void> {
  const client =
    args.client ??
    (await getAgentRuntimeDependencies().acquireOpencodeClient());
  try {
    await client.session.remove({ sessionID: args.sessionId });
    return;
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      return;
    }
    const message = getRpcErrorMessage(
      error,
      "Failed to delete OpenCode session during runtime shutdown"
    );
    process.stderr.write(
      `[agent] Failed to delete OpenCode session ${args.sessionId}: ${message}\n`
    );
  }
}

async function getCellById(id: string): Promise<Cell | null> {
  return await getCellWhere(eq(cells.id, id));
}

async function getCellBySessionId(sessionId: string): Promise<Cell | null> {
  return await getCellWhere(eq(cells.opencodeSessionId, sessionId));
}

async function getCellWhere(
  where: ReturnType<typeof eq>
): Promise<Cell | null> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const [cell] = await runtimeDb.select().from(cells).where(where).limit(1);
  return cell ?? null;
}
