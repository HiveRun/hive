import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  OpenCodeClient,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
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
import { normalizeProviderDefaults } from "./provider-defaults";
import type {
  AgentMessagePart,
  AgentMessageRecord,
  AgentMessageRole,
  AgentMessageState,
  AgentMode,
  AgentRuntimeEvent,
  AgentSessionRecord,
  AgentSessionStatus,
} from "./types";

const runtimeRegistry = new Map<string, RuntimeHandle>();
const cellSessionMap = new Map<string, string>();
const EVENT_STREAM_RECONNECT_DELAY_MS = 1000;
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
const HIVE_INSTRUCTIONS_RELATIVE_PATH = ".hive/instructions.md";
const HIVE_PLUGIN_ID = "hive.cell.v2.r1.tools-context-shell-permission";

type DirectoryQuery = {
  directory?: string;
};

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

type RuntimeCompactionState = {
  count: number;
  lastCompactionAt: string | null;
};

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
  directoryQuery: DirectoryQuery;
  client: OpenCodeClient;
  abortController: AbortController;
  status: AgentSessionStatus;
  pendingInterrupt: boolean;
  preserveResumeOnInterrupt: boolean;
  compaction: RuntimeCompactionState;
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

type ProviderVariant = {
  disabled?: boolean;
};

export type ProviderModel = {
  id?: string;
  name?: string;
  variants?: Record<string, ProviderVariant>;
};

export type ProviderEntry = {
  id: string;
  name?: string;
  models?: Record<string, ProviderModel>;
};

type ProviderCatalogResponse = {
  providers: ProviderEntry[];
  default: Record<string, string>;
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

async function loadProvisioningModelOverride(args: {
  runtimeDb: AgentRuntimeDependencies["db"];
  cellId: string;
}): Promise<ModelSelectionCandidate | undefined> {
  const [provisioningState] = await args.runtimeDb
    .select({
      modelId: cellProvisioningStates.modelIdOverride,
      providerId: cellProvisioningStates.providerIdOverride,
      variant: cellProvisioningStates.variantOverride,
    })
    .from(cellProvisioningStates)
    .where(eq(cellProvisioningStates.cellId, args.cellId))
    .limit(1);

  if (!provisioningState?.modelId) {
    return;
  }

  return {
    modelId: provisioningState.modelId,
    ...(provisioningState.providerId
      ? { providerId: provisioningState.providerId }
      : {}),
    ...(provisioningState.variant
      ? { variant: provisioningState.variant }
      : {}),
  };
}

async function loadProvisioningStartMode(args: {
  runtimeDb: AgentRuntimeDependencies["db"];
  cellId: string;
}): Promise<AgentMode | undefined> {
  const [provisioningState] = await args.runtimeDb
    .select({
      startMode: cellProvisioningStates.startMode,
    })
    .from(cellProvisioningStates)
    .where(eq(cellProvisioningStates.cellId, args.cellId))
    .limit(1);

  return normalizeAgentMode(provisioningState?.startMode ?? undefined);
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
    const directoryQuery: DirectoryQuery = {
      directory: args.cell.workspacePath,
    };
    const existingSession = await getRemoteSession(
      client,
      directoryQuery,
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
  cellId: string;
  options?: EnsureAgentSessionOptions;
  deps: AgentRuntimeDependencies;
}): Promise<ModelSelectionCandidate | undefined> {
  const explicitModelSelection = resolveExplicitModelSelection(args.options);
  if (explicitModelSelection) {
    return explicitModelSelection;
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

  return loadProvisioningModelOverride({
    runtimeDb: args.deps.db,
    cellId: args.cellId,
  });
}

type ProviderCatalogInfo = {
  providers: ProviderEntry[];
  defaults: Record<string, string>;
};

function buildProviderCatalogInfo(
  catalog: ProviderCatalogResponse | undefined
): ProviderCatalogInfo {
  const providers: ProviderEntry[] = [];
  const candidates = catalog?.providers;

  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof (candidate as { id?: unknown }).id !== "string"
      ) {
        continue;
      }

      const { id, name, models } = candidate as {
        id: string;
        name?: string;
        models?: Record<string, ProviderModel>;
      };
      const providerEntry: ProviderEntry = { id };
      if (name) {
        providerEntry.name = name;
      }
      if (models) {
        providerEntry.models = models;
      }
      providers.push(providerEntry);
    }
  }

  const defaults = normalizeProviderDefaults(
    (catalog as { default?: unknown } | undefined)?.default
  );

  return { providers, defaults };
}

function findProviderById(
  providers: ProviderEntry[],
  providerId: string | undefined
): ProviderEntry | undefined {
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

function listProviderModelIdentifiers(provider: ProviderEntry): string[] {
  const models = provider.models;
  if (!models) {
    return [];
  }

  const unique = new Set<string>();
  for (const [modelKey, model] of Object.entries(models)) {
    unique.add(modelKey);
    if (model.id) {
      unique.add(model.id);
    }
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function listProviderModelVariantIdentifiers(args: {
  provider: ProviderEntry;
  modelId: string;
}): string[] {
  const model = args.provider.models?.[args.modelId];
  if (!model?.variants) {
    return [];
  }

  return Object.entries(model.variants)
    .filter(([, variant]) => !variant?.disabled)
    .map(([variantId]) => variantId)
    .sort((a, b) => a.localeCompare(b));
}

function buildInvalidModelOverrideMessage(args: {
  modelId: string;
  providerId?: string;
  providers: ProviderEntry[];
}): string {
  const { modelId, providerId, providers } = args;

  if (providerId) {
    const provider = findProviderById(providers, providerId);
    if (!provider) {
      const providerIds = providers.map((entry) => entry.id).sort();
      const availableProviders = providerIds.length
        ? formatListPreview(providerIds)
        : "none";
      return `Selected model override is invalid: provider "${providerId}" was not found. Available providers: ${availableProviders}. Refresh the model catalog and try again.`;
    }

    const availableModels = listProviderModelIdentifiers(provider);
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
  providers: ProviderEntry[];
}): string {
  const provider = findProviderById(args.providers, args.providerId);
  if (!provider?.models?.[args.modelId]) {
    return `Selected model variant override is invalid: model "${args.modelId}" is unavailable for provider "${args.providerId}".`;
  }

  const availableVariants = listProviderModelVariantIdentifiers({
    provider,
    modelId: args.modelId,
  });
  const variantSummary = availableVariants.length
    ? formatListPreview(availableVariants)
    : "none";

  return `Selected model variant override is invalid: variant "${args.variant}" is unavailable for model "${args.modelId}" on provider "${args.providerId}". Available variants: ${variantSummary}. Refresh the model catalog and try again.`;
}

function resolveProviderModelMatch(
  provider: ProviderEntry,
  candidateModelId: string
): string | undefined {
  const models = provider.models;
  if (!models) {
    return;
  }

  if (models[candidateModelId]) {
    return candidateModelId;
  }

  const match = Object.entries(models).find(
    ([, model]) => model.id === candidateModelId
  );

  return match?.[0];
}

function resolveProviderVariantMatch(args: {
  provider: ProviderEntry;
  modelId: string;
  candidateVariant: string | undefined;
}): string | undefined | null {
  if (!args.candidateVariant) {
    return;
  }

  const variants = args.provider.models?.[args.modelId]?.variants;
  if (!variants) {
    return null;
  }

  const variant = variants[args.candidateVariant];
  if (variant && !variant.disabled) {
    return args.candidateVariant;
  }

  return null;
}

function getFirstModelId(
  models: Record<string, ProviderModel> | undefined
): string | undefined {
  if (!models) {
    return;
  }

  const [firstModel] = Object.values(models);
  if (firstModel?.id) {
    return firstModel.id;
  }

  const modelIds = Object.keys(models);
  return modelIds.length ? modelIds[0] : undefined;
}

function resolveCandidateModelForProvider(args: {
  provider: ProviderEntry;
  candidate: ModelSelectionCandidate;
}): ModelSelectionCandidate | null {
  if (!args.candidate.modelId) {
    return null;
  }

  const resolvedModelId = resolveProviderModelMatch(
    args.provider,
    args.candidate.modelId
  );
  if (!resolvedModelId) {
    return null;
  }

  const resolvedVariant = resolveProviderVariantMatch({
    provider: args.provider,
    modelId: resolvedModelId,
    candidateVariant: args.candidate.variant,
  });
  if (args.candidate.variant && !resolvedVariant) {
    return null;
  }

  return {
    providerId: args.provider.id,
    modelId: resolvedModelId,
    ...(resolvedVariant ? { variant: resolvedVariant } : {}),
  };
}

function resolveCandidateModel({
  candidate,
  providers,
}: {
  candidate: ModelSelectionCandidate;
  providers: ProviderEntry[];
}): ModelSelectionCandidate | null {
  if (!candidate.modelId) {
    return null;
  }

  if (candidate.providerId) {
    const provider = findProviderById(providers, candidate.providerId);
    if (provider) {
      return resolveCandidateModelForProvider({ provider, candidate });
    }
    return null;
  }

  for (const provider of providers) {
    const resolved = resolveCandidateModelForProvider({ provider, candidate });
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

/**
 * Mirrors the OpenCode TUI model fallback order:
 * 1) CLI override, 2) opencode.json model, 3) recent model,
 * 4) provider default, 5) first available model.
 */
function resolveModelFallback({
  candidates,
  providers,
  defaults,
}: {
  candidates: ModelSelectionCandidate[];
  providers: ProviderEntry[];
  defaults: Record<string, string>;
}): ModelSelectionCandidate | null {
  for (const candidate of candidates) {
    const resolved = resolveCandidateModel({ candidate, providers });
    if (resolved) {
      return resolved;
    }
  }

  const [provider] = providers;
  if (!provider?.models) {
    return null;
  }

  const defaultModelId = defaults[provider.id];
  if (defaultModelId && provider.models[defaultModelId]) {
    return { providerId: provider.id, modelId: defaultModelId };
  }

  const modelId = getFirstModelId(provider.models);
  return modelId ? { providerId: provider.id, modelId } : null;
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
  providers: ProviderEntry[];
  defaults: Record<string, string>;
};

function resolveModelSelection({
  options,
  agentConfig,
  defaultOpencodeModel,
  configDefaultProvider,
  configDefaultModel,
  providers,
  defaults,
}: ModelSelectionContext): ResolvedModelSelection {
  const overrideModel = resolveCandidateModel({
    candidate: {
      providerId: options?.providerId,
      modelId: options?.modelId,
      variant: options?.variant,
    },
    providers,
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
      })?.providerId;

    if (options.variant && resolvedProviderId) {
      const resolvedModelId =
        resolveCandidateModel({
          candidate: {
            providerId: resolvedProviderId,
            modelId: options.modelId,
          },
          providers,
        })?.modelId ?? options.modelId;

      throw new Error(
        buildInvalidVariantOverrideMessage({
          providerId: resolvedProviderId,
          modelId: resolvedModelId,
          variant: options.variant,
          providers,
        })
      );
    }

    throw new Error(
      buildInvalidModelOverrideMessage({
        modelId: options.modelId,
        providerId: options.providerId,
        providers,
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
  });

  const validOpencodeDefault = resolveCandidateModel({
    candidate: {
      providerId: defaultOpencodeModel?.providerId,
      modelId: defaultOpencodeModel?.modelId,
      variant: defaultOpencodeModel?.variant,
    },
    providers,
  });

  const configFallback = resolveCandidateModel({
    candidate: {
      providerId: configDefaultProvider,
      modelId: configDefaultModel,
    },
    providers,
  });

  const providerFallback = resolveModelFallback({
    candidates: [],
    providers,
    defaults,
  });

  const resolvedSelection = pickResolvedSelection({
    overrideModel,
    agentModel,
    validOpencodeDefault,
    configFallback,
    providerFallback,
  });
  const resolvedModel = resolvedSelection;
  const effectiveOptions = options;
  const effectiveAgentConfig =
    agentConfig?.modelId && !agentModel ? undefined : agentConfig;

  const providerId =
    resolvedModel?.providerId ??
    resolveProviderId(
      effectiveOptions,
      effectiveAgentConfig,
      validOpencodeDefault ?? undefined,
      configDefaultProvider
    );

  const modelId =
    resolvedModel?.modelId ??
    resolveModelId({
      options: effectiveOptions,
      agentConfig: effectiveAgentConfig,
      configDefaultModel,
      defaultOpencodeModel: validOpencodeDefault ?? undefined,
      resolvedProviderId: providerId,
    });

  return {
    source: resolvedSelection.source,
    providerId,
    modelId,
    ...(resolvedModel?.variant ? { variant: resolvedModel.variant } : {}),
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
  await synchronizeRuntimeMode(runtime);
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
}

export async function fetchAgentMessages(
  sessionId: string
): Promise<AgentMessageRecord[]> {
  const runtime = await ensureRuntimeForSession(sessionId);
  return loadRemoteMessages(runtime);
}

export async function fetchCompactionStats(
  sessionId: string
): Promise<RuntimeCompactionState> {
  const runtime = await ensureRuntimeForSession(sessionId);
  return runtime.compaction;
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
    directoryQuery: { directory: cell.workspacePath },
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

  if (await shouldResumeRuntime(runtime)) {
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

async function shouldResumeRuntime(runtime: RuntimeHandle): Promise<boolean> {
  const messages = await fetchRuntimeMessages(runtime, {
    requireMessages: true,
  });
  if (!messages) {
    return Boolean(runtime.cell.resumeAgentSessionOnStartup);
  }

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return Boolean(runtime.cell.resumeAgentSessionOnStartup);
  }

  if (shouldResumeFromMessage(lastMessage)) {
    return true;
  }

  if (!runtime.cell.resumeAgentSessionOnStartup) {
    return false;
  }

  return !isCompletedAssistantMessage(lastMessage);
}

function shouldResumeFromMessage(message: RuntimeMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.error) {
    return false;
  }
  return !message.time.completed;
}

function isCompletedAssistantMessage(message: RuntimeMessage): boolean {
  return (
    message.role === "assistant" &&
    (Boolean(message.error) || Boolean(message.time.completed))
  );
}

type AgentRuntimeError = {
  readonly _tag: "AgentRuntimeError";
  readonly cause: unknown;
};

const makeAgentRuntimeError = (cause: unknown): AgentRuntimeError => ({
  _tag: "AgentRuntimeError",
  cause,
});

const wrapAgentRuntime =
  <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) =>
  async (...args: Args): Promise<Result> => {
    try {
      return await fn(...args);
    } catch (cause) {
      throw makeAgentRuntimeError(cause);
    }
  };

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
  readonly fetchCompactionStats: (
    sessionId: string
  ) => Promise<RuntimeCompactionState>;
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
  ) => Promise<ProviderCatalogResponse>;
};

const makeAgentRuntimeService = (): AgentRuntimeService => ({
  ensureAgentSession: (cellId, options) =>
    wrapAgentRuntime(ensureAgentSession)(cellId, options),
  fetchAgentSession: (sessionId) =>
    wrapAgentRuntime(fetchAgentSession)(sessionId),
  fetchAgentSessionForCell: (cellId) =>
    wrapAgentRuntime(fetchAgentSessionForCell)(cellId),
  fetchAgentMessages: (sessionId) =>
    wrapAgentRuntime(fetchAgentMessages)(sessionId),
  fetchCompactionStats: (sessionId) =>
    wrapAgentRuntime(fetchCompactionStats)(sessionId),
  updateAgentSessionModel: (sessionId, model) =>
    wrapAgentRuntime(updateAgentSessionModel)(sessionId, model),
  sendAgentMessage: (sessionId, content) =>
    wrapAgentRuntime(sendAgentMessage)(sessionId, content),
  interruptAgentSession: (sessionId) =>
    wrapAgentRuntime(interruptAgentSession)(sessionId),
  stopAgentSession: (sessionId, options) =>
    wrapAgentRuntime(stopAgentSession)(sessionId, options),
  closeAgentSession: (cellId) => wrapAgentRuntime(closeAgentSession)(cellId),
  closeAllAgentSessions: (options) =>
    wrapAgentRuntime(closeAllAgentSessions)(options),
  respondAgentPermission: (sessionId, permissionId, response) =>
    wrapAgentRuntime(respondAgentPermission)(sessionId, permissionId, response),
  fetchProviderCatalogForWorkspace: (workspaceRootPath) =>
    wrapAgentRuntime(fetchProviderCatalogForWorkspace)(workspaceRootPath),
});

export const agentRuntimeService = makeAgentRuntimeService();

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

function loadHiveConfigForWorkspace(
  deps: AgentRuntimeDependencies,
  workspaceRootPath: string
): Promise<HiveConfig> {
  return deps.loadHiveConfig(workspaceRootPath);
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
  const hiveConfig = await loadHiveConfigForWorkspace(deps, workspaceRootPath);
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
  const { providers, defaults } = buildProviderCatalogInfo(providerCatalog);

  const selectionOptions = await resolveRuntimeModelSelectionOptions({
    cell,
    cellId,
    options,
    deps,
  });

  const persistedStartMode = await loadProvisioningStartMode({
    runtimeDb: deps.db,
    cellId,
  });
  const startMode =
    options?.startMode ?? persistedStartMode ?? configDefaultMode;

  const selection = resolveModelSelection({
    options: selectionOptions,
    agentConfig,
    defaultOpencodeModel,
    configDefaultProvider,
    configDefaultModel,
    providers,
    defaults,
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
    beforeInitialReconciliation: async () => {
      restoredModel = await resolveSessionModelPreference(runtime);
      if (restoredModel && !options?.modelId) {
        runtime.providerId = restoredModel.providerId;
        runtime.modelId = restoredModel.modelId;
        runtime.variant = restoredModel.variant;
      }

      const restoredMode = await resolveSessionModePreference(runtime);
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
): Promise<ProviderCatalogResponse> {
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
    const providersById = new Map<string, ProviderEntry>();

    for (const provider of providerResult.data) {
      providersById.set(provider.id, {
        id: provider.id,
        name: provider.name,
        models: {},
      });
    }

    for (const model of modelResult.data) {
      if (!model.enabled) {
        continue;
      }
      const provider = providersById.get(model.providerID) ?? {
        id: model.providerID,
        models: {},
      };
      provider.models ??= {};
      provider.models[model.id] = {
        id: model.id,
        name: model.name,
        variants: Object.fromEntries(
          model.variants.map((variant) => [variant.id, {}])
        ),
      };
      providersById.set(provider.id, provider);
    }

    const defaults = defaultResult.data
      ? { [defaultResult.data.providerID]: defaultResult.data.id }
      : {};
    return { providers: Array.from(providersById.values()), default: defaults };
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
  const directoryQuery: DirectoryQuery = { directory: cell.workspacePath };
  const { session, created } = await resolveOpencodeSession({
    client,
    cell,
    directoryQuery,
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
    directoryQuery,
    client,
    abortController,
    status: "awaiting_input",
    pendingInterrupt: false,
    preserveResumeOnInterrupt: false,
    compaction: { count: 0, lastCompactionAt: null },
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
          directoryQuery,
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
  directoryQuery: DirectoryQuery;
  startMode: AgentMode;
  force: boolean;
};

async function resolveOpencodeSession({
  client,
  cell,
  directoryQuery,
  startMode,
  force,
}: ResolveSessionArgs): Promise<{ session: SessionInfo; created: boolean }> {
  if (!force && cell.opencodeSessionId) {
    const existing = await getRemoteSession(
      client,
      directoryQuery,
      cell.opencodeSessionId
    );
    if (existing) {
      return { session: existing, created: false };
    }
  }

  const created = await client.session.create({
    title: cell.name,
    agent: startMode,
    location: { directory: directoryQuery.directory ?? cell.workspacePath },
  });

  return { session: created, created: true };
}

async function getRemoteSession(
  client: OpenCodeClient,
  _directoryQuery: DirectoryQuery,
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
  beforeInitialReconciliation: () => Promise<void>;
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
  beforeInitialReconciliation: () => Promise<void>;
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
  beforeReconcile?: () => Promise<void>
): Promise<void> {
  const events = runtime.client.event.subscribe({ signal });
  const iterator =
    (events as AsyncIterable<OpenCodeEvent>)[Symbol.asyncIterator]?.() ??
    (events as unknown as Iterable<OpenCodeEvent>)[Symbol.iterator]();
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
    const sourceEvent = next.value;
    const event = adaptOpencodeEvent(sourceEvent);
    if (!event) {
      continue;
    }
    const eventSessionId = getEventSessionId(event);
    if (eventSessionId && eventSessionId !== runtime.session.id) {
      continue;
    }

    updateRuntimeModeFromEvent(runtime, event);
    updateRuntimeModelFromEvent(runtime, event);
    recordCompactionEvent(runtime, event);
    publish(runtime.session.id, event);
    await updateRuntimeStatusFromEvent(runtime, event);
  }
}

type RuntimeMessage = {
  id: string;
  sessionID: string;
  role: AgentMessageRole;
  time: { created: number; completed?: number };
  parts: AgentMessagePart[];
  model?: { providerID: string; modelID: string; variant?: string };
  mode?: string;
  parentID?: string;
  error?: unknown;
};

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

function adaptOpencodeMessage(
  sessionId: string,
  message: SessionMessageInfo
): RuntimeMessage {
  if (message.type === "user") {
    const parts: AgentMessagePart[] = message.text
      ? [{ type: "text", text: message.text }]
      : [];
    parts.push(...(message.files ?? []).map(toRuntimeFilePart));
    return {
      id: message.id,
      sessionID: sessionId,
      role: "user",
      time: { created: message.time.created, completed: message.time.created },
      parts,
    };
  }

  if (message.type === "assistant") {
    return {
      id: message.id,
      sessionID: sessionId,
      role: "assistant",
      time: message.time,
      parts: message.content.map((part) => ({ ...part })),
      model: {
        providerID: message.model.providerID,
        modelID: message.model.id,
        ...(message.model.variant ? { variant: message.model.variant } : {}),
      },
      mode: message.agent,
      ...(message.error ? { error: message.error } : {}),
    };
  }

  return adaptOpencodeSystemMessage(sessionId, message);
}

type OpencodeSystemMessage = Exclude<
  SessionMessageInfo,
  { type: "user" } | { type: "assistant" }
>;

function getOpencodeSystemMessageText(message: OpencodeSystemMessage): string {
  if ("text" in message && typeof message.text === "string") {
    return message.text;
  }
  if (message.type === "shell") {
    return message.output?.output ?? message.command;
  }
  if (message.type === "compaction" && message.status !== "failed") {
    return message.summary;
  }
  return "";
}

function adaptOpencodeSystemMessage(
  sessionId: string,
  message: OpencodeSystemMessage
): RuntimeMessage {
  const text = getOpencodeSystemMessageText(message);
  const model =
    message.type === "model-switched"
      ? {
          providerID: message.model.providerID,
          modelID: message.model.id,
          ...(message.model.variant ? { variant: message.model.variant } : {}),
        }
      : undefined;
  const mode = message.type === "agent-switched" ? message.agent : undefined;

  return {
    id: message.id,
    sessionID: sessionId,
    role: "system",
    time: { created: message.time.created, completed: message.time.created },
    parts: text ? [{ type: "text", text }] : [],
    ...(model ? { model } : {}),
    ...(mode ? { mode } : {}),
    ...(message.type === "compaction" && message.status === "failed"
      ? { error: message.error }
      : {}),
  };
}

async function resolveSessionModelPreference(
  runtime: RuntimeHandle
): Promise<{ providerId: string; modelId: string; variant?: string } | null> {
  if (runtime.session.model) {
    return {
      providerId: runtime.session.model.providerID,
      modelId: runtime.session.model.id,
      ...(runtime.session.model.variant
        ? { variant: runtime.session.model.variant }
        : {}),
    };
  }

  try {
    const info = await findLatestMessageInfo(runtime, (message) => {
      const modelSelection = extractMessageModelSelection(message);
      return Boolean(modelSelection);
    });
    const modelSelection = info ? extractMessageModelSelection(info) : null;
    if (!modelSelection) {
      return null;
    }

    return {
      providerId: modelSelection.providerId,
      modelId: modelSelection.modelId,
      ...(modelSelection.variant ? { variant: modelSelection.variant } : {}),
    };
  } catch {
    return null;
  }
}

async function resolveSessionModePreference(
  runtime: RuntimeHandle
): Promise<AgentMode | null> {
  const sessionMode = normalizeAgentMode(runtime.session.agent);
  if (sessionMode) {
    return sessionMode;
  }

  try {
    const info = await findLatestMessageInfo(runtime, (message) =>
      Boolean(resolveMessageMode(message))
    );
    return info ? (resolveMessageMode(info) ?? null) : null;
  } catch {
    return null;
  }
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

async function findLatestMessageInfo(
  runtime: RuntimeHandle,
  matches: (message: RuntimeMessage) => boolean
): Promise<RuntimeMessage | null> {
  for await (const source of iterateRemoteMessages(runtime, {
    limit: 100,
    order: "desc",
  })) {
    const message = adaptOpencodeMessage(runtime.session.id, source);
    if (matches(message)) {
      return message;
    }
  }

  return null;
}

async function synchronizeRuntimeMode(runtime: RuntimeHandle): Promise<void> {
  const resolvedMode = await resolveSessionModePreference(runtime);
  if (!resolvedMode) {
    return;
  }

  setRuntimeMode(runtime, resolvedMode);
}

async function resolveSessionStatusPreference(
  runtime: RuntimeHandle
): Promise<AgentSessionStatus | null> {
  try {
    const messages = await fetchRuntimeMessages(runtime, {
      requireMessages: true,
    });
    if (!messages) {
      return runtime.cell.resumeAgentSessionOnStartup ? "working" : null;
    }

    const lastMessage = messages.at(-1);
    if (!lastMessage) {
      return runtime.cell.resumeAgentSessionOnStartup ? "working" : null;
    }

    if (shouldResumeFromMessage(lastMessage)) {
      return "working";
    }

    if (
      runtime.cell.resumeAgentSessionOnStartup &&
      !isCompletedAssistantMessage(lastMessage)
    ) {
      return "working";
    }

    return null;
  } catch {
    return runtime.cell.resumeAgentSessionOnStartup ? "working" : null;
  }
}

async function fetchRuntimeMessages(
  runtime: RuntimeHandle,
  options: { requireMessages?: boolean } = {}
) {
  const page = await runtime.client.message.list({
    sessionID: runtime.session.id,
    limit: 1,
    order: "desc",
  });

  const messages = page.data.map((message) =>
    adaptOpencodeMessage(runtime.session.id, message)
  );
  return options.requireMessages && messages.length === 0 ? null : messages;
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

  const resolvedStatus = await resolveSessionStatusPreference(runtime);
  if (!resolvedStatus) {
    return;
  }

  await applyRuntimeStatus(runtime, resolvedStatus);
}

type RuntimeLiveState = {
  active: boolean;
  inbox: Awaited<ReturnType<OpenCodeClient["session"]["inbox"]["list"]>>;
  permissions: Awaited<ReturnType<OpenCodeClient["permission"]["list"]>>;
  forms: Awaited<ReturnType<OpenCodeClient["form"]["list"]>>;
};

type PendingRuntimeInputs = Pick<RuntimeLiveState, "permissions" | "forms">;

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
): AgentRuntimeEvent[] {
  return [
    ...state.permissions.map(
      (permission): AgentRuntimeEvent => ({
        type: "permission.asked",
        properties: {
          id: permission.id,
          sessionID: permission.sessionID,
          permission: permission.action,
          patterns: permission.resources,
          metadata: permission.metadata ?? {},
          always: permission.save ?? [],
        },
      })
    ),
    ...state.forms.map(
      (form): AgentRuntimeEvent => ({
        type: "question.asked",
        properties: {
          id: form.id,
          sessionID: form.sessionID,
          questions: [{ question: form.title }],
        },
      })
    ),
  ];
}

export async function fetchPendingAgentInputEvents(
  sessionId: string
): Promise<AgentRuntimeEvent[]> {
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

type MessageModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

function extractMessageModelSelection(
  info: RuntimeMessage
): MessageModelSelection | null {
  const candidate = (info as { model?: unknown }).model;
  if (
    candidate &&
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { providerID?: unknown }).providerID === "string" &&
    typeof (candidate as { modelID?: unknown }).modelID === "string"
  ) {
    const { providerID, modelID, variant } = candidate as {
      providerID: string;
      modelID: string;
      variant?: string;
    };
    return {
      providerId: providerID,
      modelId: modelID,
      ...(typeof variant === "string" ? { variant } : {}),
    };
  }
  return null;
}

function getMessageParentId(info: RuntimeMessage): string | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.parentID ?? null;
}

function getAssistantErrorDetails(info: RuntimeMessage): unknown | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.error ?? null;
}

type MessageUpdatedEvent = Extract<
  AgentRuntimeEvent,
  { type: "message.updated" }
>;

function createMessageUpdatedEvent(input: {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  created: number;
  completed?: boolean;
  mode?: string;
  model?: { providerID: string; id: string; variant?: string };
}): MessageUpdatedEvent {
  const { id, sessionID, role, created, completed, mode, model } = input;
  return {
    type: "message.updated",
    properties: {
      info: {
        id,
        sessionID,
        role,
        time: completed ? { created, completed: created } : { created },
        ...(mode ? { mode } : {}),
        ...(model
          ? {
              model: {
                providerID: model.providerID,
                modelID: model.id,
                ...(model.variant ? { variant: model.variant } : {}),
              },
            }
          : {}),
      },
    },
  };
}

function createSelectionMessageUpdatedEvent(
  event: Extract<
    OpenCodeEvent,
    { type: "session.agent.selected" | "session.model.selected" }
  >
): MessageUpdatedEvent {
  return createMessageUpdatedEvent({
    id: event.id,
    sessionID: event.data.sessionID,
    role: "user",
    created: event.created,
    completed: true,
    ...(event.type === "session.agent.selected"
      ? { mode: event.data.agent }
      : { model: event.data.model }),
  });
}

export function adaptOpencodeEvent(
  event: OpenCodeEvent
): AgentRuntimeEvent | null {
  switch (event.type) {
    case "session.status":
      return { type: "session.status", properties: event.data };
    case "session.idle":
      return { type: "session.idle", properties: event.data };
    case "session.execution.started":
      return {
        type: "session.status",
        properties: {
          sessionID: event.data.sessionID,
          status: { type: "busy" },
        },
      };
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return {
        type: "session.idle",
        properties: { sessionID: event.data.sessionID },
      };
    case "session.execution.failed":
      return {
        type: "session.error",
        properties: {
          sessionID: event.data.sessionID,
          error: event.data.error,
        },
      };
    case "session.agent.selected":
    case "session.model.selected":
      return createSelectionMessageUpdatedEvent(event);
    case "session.step.started":
      return createMessageUpdatedEvent({
        id: event.data.assistantMessageID,
        sessionID: event.data.sessionID,
        role: "assistant",
        created: event.created,
        mode: event.data.agent,
        model: event.data.model,
      });
    case "permission.asked":
      return {
        type: "permission.asked",
        properties: {
          id: event.data.id,
          sessionID: event.data.sessionID,
          permission: event.data.action,
          patterns: event.data.resources,
          metadata: event.data.metadata ?? {},
          always: event.data.save ?? [],
        },
      };
    case "permission.replied":
      return {
        type: "permission.replied",
        properties: {
          sessionID: event.data.sessionID,
          permissionID: event.data.requestID,
          response: event.data.reply,
        },
      };
    case "form.created":
      return {
        type: "question.asked",
        properties: {
          id: event.data.form.id,
          sessionID: event.data.form.sessionID,
          questions: [{ question: event.data.form.title }],
        },
      };
    case "form.replied":
      return {
        type: "question.replied",
        properties: {
          id: event.data.id,
          sessionID: event.data.sessionID,
          answer: event.data.answer,
        },
      };
    case "form.cancelled":
      return {
        type: "question.rejected",
        properties: {
          id: event.data.id,
          sessionID: event.data.sessionID,
        },
      };
    case "session.compaction.ended":
      return {
        type: "session.compacted",
        properties: { sessionID: event.data.sessionID },
      };
    default:
      return null;
  }
}

function getEventSessionId(event: AgentRuntimeEvent): string {
  if (event.type === "message.updated") {
    return event.properties.info.sessionID;
  }
  return event.properties.sessionID;
}

async function updateRuntimeStatusFromEvent(
  runtime: RuntimeHandle,
  event: AgentRuntimeEvent
): Promise<void> {
  if (
    event.type === "session.error" &&
    runtime.pendingInterrupt &&
    isSessionErrorAborted(event)
  ) {
    runtime.pendingInterrupt = false;
    await applyRuntimeStatus(runtime, "awaiting_input");
    return;
  }

  if (runtime.pendingInterrupt && event.type === "message.updated") {
    return;
  }

  if (runtime.pendingInterrupt && event.type === "session.idle") {
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
  event: AgentRuntimeEvent
): { status: AgentSessionStatus; error?: string } | null {
  if (event.type === "session.error") {
    const message = extractErrorMessage(event);
    return { status: "error", error: message };
  }

  if (event.type === "session.idle") {
    return { status: "awaiting_input" };
  }

  if (event.type === "session.status") {
    if (event.properties.status.type === "idle") {
      return { status: "awaiting_input" };
    }
    return { status: "working" };
  }

  const rawType = (event as { type: string }).type;
  if (rawType === "permission.asked" || rawType === "permission.updated") {
    return { status: "awaiting_input" };
  }

  if (rawType === "permission.replied") {
    return { status: "working" };
  }

  if (rawType === "question.asked") {
    return { status: "awaiting_input" };
  }

  if (rawType === "question.replied") {
    return { status: "working" };
  }

  if (rawType === "question.rejected") {
    return { status: "awaiting_input" };
  }

  if (event.type !== "message.updated") {
    return null;
  }

  const info = event.properties.info;
  if (info.role === "assistant") {
    return { status: "working" };
  }

  return null;
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

  return messages
    .map((message) => adaptOpencodeMessage(runtime.session.id, message))
    .map(serializeMessage);
}

function serializeMessage(info: RuntimeMessage): AgentMessageRecord {
  const contentText = extractTextFromParts(info.parts);
  const parentId = getMessageParentId(info);
  const errorDetails = getAssistantErrorDetails(info);
  const isAborted = isMessageAbortedError(errorDetails);
  const abortedErrorPayload = isAborted
    ? extractRpcErrorPayload(errorDetails)
    : null;
  const errorName =
    isAborted && errorDetails && typeof errorDetails === "object"
      ? ((errorDetails as { name?: string; type?: string }).name ??
        (errorDetails as { type?: string }).type ??
        null)
      : null;

  return {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    content: contentText.length ? contentText : null,
    parts: info.parts,
    state: determineMessageState(info),
    createdAt: new Date(info.time.created).toISOString(),
    parentId,
    errorName,
    errorMessage: isAborted
      ? (abortedErrorPayload?.data?.message ??
        abortedErrorPayload?.message ??
        null)
      : null,
  };
}

function extractTextFromParts(parts: AgentMessagePart[] | undefined): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => {
      if (
        (part.type === "text" || part.type === "reasoning") &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function determineMessageState(message: RuntimeMessage): AgentMessageState {
  if (message.role === "assistant" && message.error) {
    return "error";
  }
  if (message.role === "assistant" && !message.time.completed) {
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
  event: AgentRuntimeEvent
): AgentMode | undefined {
  if (event.type !== "message.updated") {
    return;
  }

  return resolveMessageMode(event.properties.info);
}

function resolveMessageMode(info: { mode?: unknown }): AgentMode | undefined {
  const mode = (info as { mode?: unknown }).mode;
  return typeof mode === "string" ? normalizeAgentMode(mode) : undefined;
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
  event: AgentRuntimeEvent
): void {
  const nextMode = resolveRuntimeModeFromEvent(event);
  if (!nextMode) {
    return;
  }

  setRuntimeMode(runtime, nextMode);
}

function updateRuntimeModelFromEvent(
  runtime: RuntimeHandle,
  event: AgentRuntimeEvent
): void {
  if (event.type !== "message.updated" || !event.properties.info.model) {
    return;
  }
  const model = event.properties.info.model;
  runtime.providerId = model.providerID;
  runtime.modelId = model.modelID;
  runtime.variant = model.variant;
  runtime.session.model = {
    providerID: model.providerID,
    id: model.modelID,
    ...(model.variant ? { variant: model.variant } : {}),
  };
}

function resolveCompactionCount(
  event: AgentRuntimeEvent,
  previousCount: number
): number {
  if (event.type !== "session.compacted") {
    return previousCount;
  }

  const properties = (event as { properties?: unknown }).properties;
  if (properties && typeof properties === "object") {
    const candidate = properties as {
      compacted?: unknown;
      count?: unknown;
    };
    if (typeof candidate.compacted === "number") {
      return candidate.compacted;
    }
    if (typeof candidate.count === "number") {
      return candidate.count;
    }
  }

  return previousCount + 1;
}

function publishCompactionStats(runtime: RuntimeHandle): void {
  const { publishAgentEvent: publish } = getAgentRuntimeDependencies();
  publish(runtime.session.id, {
    type: "session.compaction",
    properties: {
      count: runtime.compaction.count,
      lastCompactionAt: runtime.compaction.lastCompactionAt,
    },
  });
}

function recordCompactionEvent(
  runtime: RuntimeHandle,
  event: AgentRuntimeEvent
): void {
  if (event.type !== "session.compacted") {
    return;
  }
  const nextCount = resolveCompactionCount(event, runtime.compaction.count);
  const timestamp = new Date().toISOString();
  runtime.compaction = { count: nextCount, lastCompactionAt: timestamp };
  publishCompactionStats(runtime);
}

type RpcErrorPayload = {
  message?: string;
  data?: { message?: string };
};

function extractRpcErrorPayload(error: unknown): RpcErrorPayload | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as { message?: unknown; data?: unknown };
  const payload: RpcErrorPayload = {};

  if (typeof candidate.message === "string") {
    payload.message = candidate.message;
  }

  if (candidate.data && typeof candidate.data === "object") {
    const dataMessage = (candidate.data as { message?: unknown }).message;
    if (typeof dataMessage === "string") {
      payload.data = { message: dataMessage };
    }
  }

  return payload.message || payload.data ? payload : null;
}

function extractErrorMessage(event: AgentRuntimeEvent): string {
  if (event.type !== "session.error") {
    return "Agent session error";
  }
  const rpcError = extractRpcErrorPayload(event.properties.error);
  if (rpcError?.data?.message) {
    return rpcError.data.message;
  }
  if (rpcError?.message) {
    return rpcError.message;
  }
  return "Agent session error";
}

function isSessionErrorAborted(event: AgentRuntimeEvent): boolean {
  if (event.type !== "session.error") {
    return false;
  }
  return isMessageAbortedError(event.properties.error);
}

function isMessageAbortedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    name?: string;
    type?: string;
    data?: { name?: string; message?: string };
    errors?: Array<{ name?: string }>;
  };
  if (candidate.name === "MessageAbortedError") {
    return true;
  }
  if (candidate.type === "MessageAbortedError") {
    return true;
  }
  if (candidate.data?.name === "MessageAbortedError") {
    return true;
  }
  if (
    Array.isArray(candidate.errors) &&
    candidate.errors.some((item) => item?.name === "MessageAbortedError")
  ) {
    return true;
  }
  return false;
}

function getRpcErrorMessage(error: unknown, fallback: string): string {
  const rpcError = extractRpcErrorPayload(error);
  if (!rpcError) {
    return fallback;
  }
  if (rpcError.data?.message) {
    return rpcError.data.message;
  }
  if (rpcError.message) {
    return rpcError.message;
  }
  return fallback;
}

async function deleteRemoteOpencodeSession(args: {
  sessionId: string;
  directoryQuery: DirectoryQuery;
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
