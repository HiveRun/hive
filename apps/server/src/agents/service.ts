import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AssistantMessage,
  Event,
  Message,
  OpencodeClient,
  Part,
  Session,
} from "@opencode-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { loadHiveConfig } from "../config/context";
import type { HiveConfig, Template } from "../config/schema";
import { db } from "../db";
import { cellProvisioningStates } from "../schema/cell-provisioning";
import { type Cell, cells } from "../schema/cells";
import { type CellService, cellServices } from "../schema/services";
import { publishAgentEvent } from "./events";
import { loadOpencodeConfig } from "./opencode-config";
import { acquireSharedOpencodeClient } from "./opencode-server";
import type {
  AgentMessageRecord,
  AgentMessageState,
  AgentMode,
  AgentSessionRecord,
  AgentSessionStatus,
} from "./types";

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");

const runtimeRegistry = new Map<string, RuntimeHandle>();
const cellSessionMap = new Map<string, string>();
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
const HIVE_INSTRUCTIONS_RELATIVE_PATH = ".hive/instructions.md";

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
  const hiveHome = join(cell.workspacePath, ".hive", "home");

  const lines = [
    "## Hive-Generated Environment Variables",
    `- HIVE_CELL_ID=${cell.id}`,
    `- HIVE_HOME=${hiveHome}`,
    `- HIVE_BROWSE_ROOT=${cell.workspacePath}`,
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

type RuntimeHandle = {
  session: Session;
  cell: Cell;
  providerId?: string;
  modelId?: string;
  directoryQuery: DirectoryQuery;
  client: OpencodeClient;
  abortController: AbortController;
  status: AgentSessionStatus;
  pendingInterrupt: boolean;
  compaction: RuntimeCompactionState;
  startMode: AgentMode;
  currentMode: AgentMode;
  modeUpdatedAt: string;
  sendMessage: (content: string) => Promise<void>;
  stop: (options?: StopRuntimeOptions) => Promise<void>;
};

type EnsureAgentSessionOptions = {
  force?: boolean;
  modelId?: string;
  providerId?: string;
  startMode?: AgentMode;
};

type StopRuntimeOptions = {
  deleteRemote?: boolean;
};

export type ProviderModel = {
  id?: string;
  name?: string;
};

export type ProviderEntry = {
  id: string;
  name?: string;
  models?: Record<string, ProviderModel>;
};

type ProviderCatalogResponse = NonNullable<
  Awaited<ReturnType<OpencodeClient["config"]["providers"]>>["data"]
>;

type ProviderAuthEntry = {
  token?: string;
  [key: string]: unknown;
};

type ProviderCredentialsStore = Record<string, ProviderAuthEntry>;

type AgentRuntimeDependencies = {
  db: typeof db;
  loadHiveConfig: (workspaceRoot?: string) => Promise<HiveConfig>;
  loadOpencodeConfig: typeof loadOpencodeConfig;
  publishAgentEvent: typeof publishAgentEvent;
  acquireOpencodeClient: () => Promise<OpencodeClient>;
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
  loadOpencodeConfig:
    agentRuntimeOverrides.loadOpencodeConfig ?? loadOpencodeConfig,
  publishAgentEvent:
    agentRuntimeOverrides.publishAgentEvent ?? publishAgentEvent,
  acquireOpencodeClient:
    agentRuntimeOverrides.acquireOpencodeClient ?? acquireSharedOpencodeClient,
});

async function readProviderCredentials(): Promise<ProviderCredentialsStore> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    assertIsProviderCredentialStore(parsed, AUTH_PATH);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to read provider credentials from ${AUTH_PATH}: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

function assertIsProviderCredentialStore(
  value: unknown,
  source: string
): asserts value is ProviderCredentialsStore {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Provider credentials at ${source} must be an object`);
  }

  for (const [providerId, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(
        `Credential entry for ${providerId} in ${source} must be an object`
      );
    }

    const maybeToken = (entry as { token?: unknown }).token;
    if (maybeToken !== undefined && typeof maybeToken !== "string") {
      throw new Error(
        `Credential entry for ${providerId} in ${source} has invalid "token"`
      );
    }
  }
}

const PROVIDERS_NOT_REQUIRING_AUTH = new Set(["zen", "opencode"]);

async function ensureProviderCredentials(
  providerId: string | undefined
): Promise<void> {
  if (!providerId) {
    return;
  }

  if (PROVIDERS_NOT_REQUIRING_AUTH.has(providerId)) {
    return;
  }

  const credentials = await readProviderCredentials();
  const providerAuth = credentials[providerId];
  if (!providerAuth) {
    throw new Error(
      `Missing authentication for ${providerId}. Run opencode auth login ${providerId}.`
    );
  }
}

type TemplateAgentConfig = {
  providerId: string;
  modelId?: string;
};

function resolveTemplateAgentConfig(
  template: Template
): TemplateAgentConfig | undefined {
  if (!template.agent) {
    return;
  }

  const agentConfig: TemplateAgentConfig = {
    providerId: template.agent.providerId,
  };

  if (template.agent.modelId) {
    agentConfig.modelId = template.agent.modelId;
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
};

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
  mergedOpencodeConfig: Awaited<ReturnType<typeof loadOpencodeConfig>>;
}): AgentMode {
  const explicit = normalizeAgentMode(args.hiveConfig.opencode?.defaultMode);
  if (explicit) {
    return explicit;
  }

  const mergedConfig = args.mergedOpencodeConfig.config as {
    default_agent?: unknown;
  };
  if (typeof mergedConfig.default_agent === "string") {
    const fromAgent = normalizeAgentMode(mergedConfig.default_agent);
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
}): ModelSelectionCandidate | undefined {
  if (!(options?.modelId || options?.providerId)) {
    return;
  }

  return {
    ...(options?.modelId ? { modelId: options.modelId } : {}),
    ...(options?.providerId ? { providerId: options.providerId } : {}),
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

function normalizeProviderDefaults(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const [providerId, modelId] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (typeof modelId === "string") {
      defaults[providerId] = modelId;
    }
  }
  return defaults;
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
      const resolvedModelId = resolveProviderModelMatch(
        provider,
        candidate.modelId
      );
      if (resolvedModelId) {
        return { providerId: provider.id, modelId: resolvedModelId };
      }
    }
    return null;
  }

  for (const provider of providers) {
    const resolvedModelId = resolveProviderModelMatch(
      provider,
      candidate.modelId
    );
    if (resolvedModelId) {
      return { providerId: provider.id, modelId: resolvedModelId };
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
  options?: { modelId?: string; providerId?: string };
  agentConfig?: TemplateAgentConfig;
  defaultOpencodeModel?: { providerId?: string; modelId?: string };
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
}: ModelSelectionContext): ModelSelectionCandidate {
  const overrideModel = resolveCandidateModel({
    candidate: {
      providerId: options?.providerId,
      modelId: options?.modelId,
    },
    providers,
  });

  if (options?.modelId && !overrideModel) {
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
    },
    providers,
  });

  const validOpencodeDefault = resolveCandidateModel({
    candidate: {
      providerId: defaultOpencodeModel?.providerId,
      modelId: defaultOpencodeModel?.modelId,
    },
    providers,
  });

  const workspaceFallback = resolveModelFallback({
    candidates: [
      {
        providerId: validOpencodeDefault?.providerId,
        modelId: validOpencodeDefault?.modelId,
      },
    ],
    providers,
    defaults,
  });

  const providerFallback = resolveModelFallback({
    candidates: [],
    providers,
    defaults,
  });

  const resolvedModel =
    overrideModel ?? agentModel ?? workspaceFallback ?? providerFallback;
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

  return { providerId, modelId };
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
  try {
    const runtime = await ensureRuntimeForSession(sessionId);
    await synchronizeRuntimeMode(runtime);
    return toSessionRecord(runtime);
  } catch {
    return null;
  }
}

export async function fetchAgentSessionForCell(
  cellId: string
): Promise<AgentSessionRecord | null> {
  try {
    const runtime = await ensureRuntimeForCell(cellId, {
      force: false,
    });
    await synchronizeRuntimeMode(runtime);
    return toSessionRecord(runtime);
  } catch {
    return null;
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
  model: { modelId: string; providerId?: string }
): Promise<AgentSessionRecord> {
  const runtime = await ensureRuntimeForSession(sessionId);
  const nextProviderId = model.providerId ?? runtime.providerId;
  await ensureProviderCredentials(nextProviderId);
  runtime.providerId = nextProviderId;
  runtime.modelId = model.modelId;
  return toSessionRecord(runtime);
}

export async function sendAgentMessage(
  sessionId: string,
  content: string
): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  await runtime.sendMessage(content);
}

export async function interruptAgentSession(sessionId: string): Promise<void> {
  const runtime = await ensureRuntimeForSession(sessionId);
  runtime.pendingInterrupt = true;
  const result = await runtime.client.session.abort({
    path: { id: runtime.session.id },
    query: runtime.directoryQuery,
  });

  if (result.error) {
    runtime.pendingInterrupt = false;
    throw new Error(
      getRpcErrorMessage(result.error, "Failed to interrupt agent session")
    );
  }

  setRuntimeStatus(runtime, "awaiting_input");
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

const RESUME_SESSION_PROMPT = "Please continue";

export async function markAgentSessionsForResume(): Promise<void> {
  const activeRuntimes = Array.from(runtimeRegistry.values()).filter(
    (runtime) => runtime.status === "working" && !runtime.pendingInterrupt
  );
  if (activeRuntimes.length === 0) {
    return;
  }

  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const cellIds = activeRuntimes.map((runtime) => runtime.cell.id);
  await runtimeDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: true })
    .where(inArray(cells.id, cellIds));
}

export async function resumeAgentSessionsOnStartup(): Promise<void> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const cellsToResume = await runtimeDb
    .select()
    .from(cells)
    .where(eq(cells.resumeAgentSessionOnStartup, true));

  if (cellsToResume.length === 0) {
    return;
  }

  for (const cell of cellsToResume) {
    try {
      const runtime = await ensureRuntimeForCell(cell.id, { force: false });
      const shouldResume = await shouldResumeRuntime(runtime);
      if (shouldResume) {
        await runtime.sendMessage(RESUME_SESSION_PROMPT);
      }
      await runtimeDb
        .update(cells)
        .set({ resumeAgentSessionOnStartup: false })
        .where(eq(cells.id, cell.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[agent] Failed to resume agent session for ${cell.id}: ${message}\n`
      );
    }
  }
}

async function shouldResumeRuntime(runtime: RuntimeHandle): Promise<boolean> {
  const query = runtime.directoryQuery.directory
    ? { directory: runtime.directoryQuery.directory, limit: 100 }
    : { limit: 100 };
  const response = await runtime.client.session.messages({
    path: { id: runtime.session.id },
    query,
  });

  if (response.error || !response.data?.length) {
    return false;
  }

  const lastMessage = response.data.at(-1)?.info;
  if (!lastMessage) {
    return false;
  }

  return shouldResumeFromMessage(lastMessage);
}

function shouldResumeFromMessage(message: Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.error) {
    return false;
  }
  return !message.time.completed;
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
    model: { modelId: string; providerId?: string }
  ) => Promise<AgentSessionRecord>;
  readonly sendAgentMessage: (
    sessionId: string,
    content: string
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
  const result = await runtime.client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    query: runtime.directoryQuery,
    body: { response },
  });

  if (result.error) {
    throw new Error(
      getRpcErrorMessage(result.error, "Failed to respond to permission")
    );
  }
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

async function loadCellForRuntime(cellId: string): Promise<Cell> {
  const cell = await getCellById(cellId);
  if (!cell) {
    throw new Error("Cell not found");
  }
  return cell;
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
  const deps = getAgentRuntimeDependencies();
  const activeRuntime = getExistingRuntimeForCell(cellId, options);
  if (activeRuntime) {
    await hydrateInstructionsForCell(deps, activeRuntime.cell);
    return activeRuntime;
  }

  const cell = await loadCellForRuntime(cellId);
  const workspaceRootPath = cell.workspaceRootPath || cell.workspacePath;

  const { hiveConfig, template } = await hydrateInstructionsForCell(deps, cell);

  const agentConfig = resolveTemplateAgentConfig(template);
  const mergedConfig = await deps.loadOpencodeConfig(workspaceRootPath);
  const defaultOpencodeModel = mergedConfig.defaultModel;
  const configDefaultProvider = hiveConfig.opencode?.defaultProvider;
  const configDefaultModel = hiveConfig.opencode?.defaultModel;
  const configDefaultMode = resolveConfigDefaultMode({
    hiveConfig,
    mergedOpencodeConfig: mergedConfig,
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

  const requestedProviderId = selection.providerId;
  const requestedModelId = selection.modelId;

  await ensureProviderCredentials(requestedProviderId);

  const { runtime, created: createdSession } = await startOpencodeRuntime({
    cell,
    providerId: requestedProviderId,
    modelId: requestedModelId,
    startMode,
    force: options?.force ?? false,
    deps,
  });

  const restoredModel = await resolveSessionModelPreference(runtime);
  if (restoredModel && !options?.modelId) {
    await ensureProviderCredentials(restoredModel.providerId);
    runtime.providerId = restoredModel.providerId;
    runtime.modelId = restoredModel.modelId;
  }

  const restoredMode = await resolveSessionModePreference(runtime);
  if (restoredMode) {
    setRuntimeMode(runtime, restoredMode);
  }

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
  restoredModel: { providerId: string; modelId: string } | null;
}): boolean {
  if (!(args.selectionOptions?.modelId && args.runtime.modelId)) {
    return false;
  }

  if (!args.restoredModel) {
    return true;
  }

  return !(
    args.restoredModel.modelId === args.runtime.modelId &&
    args.restoredModel.providerId === args.runtime.providerId
  );
}

const isIdleValidationConfigMissingError = (error: unknown): boolean => {
  const candidate = error as
    | { name?: unknown; data?: unknown }
    | null
    | undefined;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const name =
    "name" in candidate ? (candidate as { name?: unknown }).name : undefined;
  if (name !== "UnknownError") {
    return false;
  }

  const data =
    "data" in candidate ? (candidate as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") {
    return false;
  }

  const message = (data as { message?: unknown }).message;
  if (typeof message !== "string") {
    return false;
  }

  return message.includes(
    "Idle validation plugin requires .opencode/plugin/idle-validate.json configuration file."
  );
};

export async function fetchProviderCatalogForWorkspace(
  workspaceRootPath: string
): Promise<ProviderCatalogResponse> {
  const { acquireOpencodeClient: acquireClient } =
    getAgentRuntimeDependencies();
  const client = await acquireClient();

  const fetchProviders = async (directory?: string) => {
    const response = await client.config.providers({
      throwOnError: true,
      ...(directory ? { query: { directory } } : {}),
    });

    if (!response.data) {
      throw new Error("OpenCode server returned an empty provider catalog");
    }

    return response.data;
  };

  try {
    return await fetchProviders(workspaceRootPath);
  } catch (error) {
    const isIdlePluginError = isIdleValidationConfigMissingError(error);

    // biome-ignore lint/suspicious/noConsole: server-side diagnostic logging
    console.error("[opencode] config.providers error", {
      workspaceRootPath,
      error,
      isIdlePluginError,
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
  startMode: AgentMode;
  force: boolean;
  deps: AgentRuntimeDependencies;
};

async function primeSessionAgentMode(args: {
  client: OpencodeClient;
  sessionId: string;
  directoryQuery: DirectoryQuery;
  startMode: AgentMode;
  providerId?: string;
  modelId?: string;
}): Promise<void> {
  if (args.startMode !== "plan") {
    return;
  }

  try {
    const modelSelection =
      args.providerId && args.modelId
        ? {
            model: {
              providerID: args.providerId,
              modelID: args.modelId,
            },
          }
        : {};

    await args.client.session.prompt({
      path: { id: args.sessionId },
      query: args.directoryQuery,
      body: {
        agent: "plan",
        noReply: true,
        ...modelSelection,
        parts: [
          {
            type: "text",
            text: "",
          },
        ],
      },
    });
  } catch {
    // Continue even if OpenCode rejects agent priming.
  }
}

async function startOpencodeRuntime({
  cell,
  providerId,
  modelId,
  startMode,
  force,
  deps,
}: StartRuntimeArgs): Promise<{ runtime: RuntimeHandle; created: boolean }> {
  const client = await deps.acquireOpencodeClient();
  const directoryQuery: DirectoryQuery = { directory: cell.workspacePath };
  const { session, created } = await resolveOpencodeSession({
    client,
    cell,
    directoryQuery,
    force,
  });

  if (created) {
    await primeSessionAgentMode({
      client,
      sessionId: session.id,
      directoryQuery,
      startMode,
      providerId,
      modelId,
    });
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
    directoryQuery,
    client,
    abortController,
    status: "awaiting_input",
    pendingInterrupt: false,
    compaction: { count: 0, lastCompactionAt: null },
    startMode,
    currentMode: startMode,
    modeUpdatedAt: new Date().toISOString(),
    async sendMessage(content) {
      setRuntimeStatus(runtime, "working");

      const activeModelId = runtime.modelId;
      const parts = [{ type: "text" as const, text: content }];
      const promptBody =
        activeModelId && runtime.providerId
          ? {
              parts,
              model: {
                providerID: runtime.providerId,
                modelID: activeModelId,
              },
            }
          : { parts };

      const response = await client.session.prompt({
        path: { id: session.id },
        query: directoryQuery,
        body: {
          ...promptBody,
          agent: runtime.currentMode,
        },
      });

      if (response.error) {
        if (runtime.pendingInterrupt && isMessageAbortedError(response.error)) {
          runtime.pendingInterrupt = false;
          setRuntimeStatus(runtime, "awaiting_input");
          return;
        }

        const errorMessage = getRpcErrorMessage(
          response.error,
          "Agent prompt failed"
        );
        setRuntimeStatus(runtime, "error", errorMessage);
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
          client,
        });
      }
      setRuntimeStatus(runtime, "completed");
    },
  };

  setRuntimeStatus(runtime, "awaiting_input");

  startEventStream({
    runtime,
    client,
    directoryQuery,
    abortController,
  });

  return { runtime, created };
}

type ResolveSessionArgs = {
  client: OpencodeClient;
  cell: Cell;
  directoryQuery: DirectoryQuery;
  force: boolean;
};

async function resolveOpencodeSession({
  client,
  cell,
  directoryQuery,
  force,
}: ResolveSessionArgs): Promise<{ session: Session; created: boolean }> {
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
    body: {
      title: cell.name,
    },
    query: directoryQuery,
  });

  if (created.error || !created.data) {
    throw new Error(
      getRpcErrorMessage(created.error, "Failed to create OpenCode session")
    );
  }

  return { session: created.data, created: true };
}

async function getRemoteSession(
  client: OpencodeClient,
  directoryQuery: DirectoryQuery,
  sessionId: string
): Promise<Session | null> {
  const response = await client.session.get({
    path: { id: sessionId },
    query: directoryQuery,
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

async function startEventStream({
  runtime,
  client,
  directoryQuery,
  abortController,
}: {
  runtime: RuntimeHandle;
  client: OpencodeClient;
  directoryQuery: DirectoryQuery;
  abortController: AbortController;
}) {
  try {
    const events = await client.event.subscribe({
      query: directoryQuery,
      signal: abortController.signal,
    });
    const { publishAgentEvent: publish } = getAgentRuntimeDependencies();

    for await (const event of events.stream) {
      const eventSessionId = getEventSessionId(event);
      if (eventSessionId && eventSessionId !== runtime.session.id) {
        continue;
      }

      updateRuntimeModeFromEvent(runtime, event);
      recordCompactionEvent(runtime, event);
      publish(runtime.session.id, event);
      updateRuntimeStatusFromEvent(runtime, event);
    }
  } catch {
    // Event stream closed
  }
}

async function resolveSessionModelPreference(
  runtime: RuntimeHandle
): Promise<{ providerId: string; modelId: string } | null> {
  try {
    const query = runtime.directoryQuery.directory
      ? { directory: runtime.directoryQuery.directory, limit: 100 }
      : { limit: 100 };
    const response = await runtime.client.session.messages({
      path: { id: runtime.session.id },
      query,
    });

    if (response.error || !response.data) {
      return null;
    }

    for (let index = response.data.length - 1; index >= 0; index -= 1) {
      const entry = response.data[index];
      if (!entry?.info) {
        continue;
      }
      const info: Message = entry.info;
      const modelSelection = extractMessageModelSelection(info);
      if (info.role === "user" && modelSelection) {
        return {
          providerId: modelSelection.providerId,
          modelId: modelSelection.modelId,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveSessionModePreference(
  runtime: RuntimeHandle
): Promise<AgentMode | null> {
  try {
    const query = runtime.directoryQuery.directory
      ? { directory: runtime.directoryQuery.directory, limit: 100 }
      : { limit: 100 };
    const response = await runtime.client.session.messages({
      path: { id: runtime.session.id },
      query,
    });

    if (response.error || !response.data) {
      return null;
    }

    for (let index = response.data.length - 1; index >= 0; index -= 1) {
      const entry = response.data[index];
      if (!entry?.info || entry.info.role !== "assistant") {
        continue;
      }

      const mode = normalizeAgentMode(entry.info.mode);
      if (mode) {
        return mode;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function synchronizeRuntimeMode(runtime: RuntimeHandle): Promise<void> {
  const resolvedMode = await resolveSessionModePreference(runtime);
  if (!resolvedMode) {
    return;
  }

  setRuntimeMode(runtime, resolvedMode);
}

async function seedSessionModelPreference(
  runtime: RuntimeHandle
): Promise<void> {
  if (!(runtime.providerId && runtime.modelId)) {
    return;
  }

  try {
    const response = await runtime.client.session.prompt({
      path: { id: runtime.session.id },
      query: runtime.directoryQuery,
      body: {
        noReply: true,
        model: {
          providerID: runtime.providerId,
          modelID: runtime.modelId,
        },
        parts: [],
      },
    });

    if (!response.error) {
      return;
    }

    const message = getRpcErrorMessage(
      response.error,
      "Failed to persist session model"
    );

    // biome-ignore lint/suspicious/noConsole: startup warning for non-fatal model seeding errors
    console.warn("[agent] Failed to seed session model preference", {
      cellId: runtime.cell.id,
      sessionId: runtime.session.id,
      providerId: runtime.providerId,
      modelId: runtime.modelId,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // biome-ignore lint/suspicious/noConsole: startup warning for non-fatal model seeding errors
    console.warn("[agent] Failed to seed session model preference", {
      cellId: runtime.cell.id,
      sessionId: runtime.session.id,
      providerId: runtime.providerId,
      modelId: runtime.modelId,
      message,
    });
  }
}

type MessageModelSelection = {
  providerId: string;
  modelId: string;
};

function extractMessageModelSelection(
  info: Message
): MessageModelSelection | null {
  const candidate = (info as { model?: unknown }).model;
  if (
    candidate &&
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { providerID?: unknown }).providerID === "string" &&
    typeof (candidate as { modelID?: unknown }).modelID === "string"
  ) {
    const { providerID, modelID } = candidate as {
      providerID: string;
      modelID: string;
    };
    return { providerId: providerID, modelId: modelID };
  }
  return null;
}

function getMessageParentId(info: Message): string | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.parentID ?? null;
}

function getAssistantErrorDetails(
  info: Message
): AssistantMessage["error"] | null {
  if (info.role !== "assistant") {
    return null;
  }
  return info.error ?? null;
}

function getEventSessionId(event: Event): string | null {
  switch (event.type) {
    case "message.updated":
      return event.properties.info.sessionID;
    case "message.part.updated":
      return event.properties.part.sessionID;
    case "message.part.removed":
      return event.properties.sessionID ?? null;
    case "permission.updated":
      return event.properties.sessionID ?? null;
    case "permission.replied":
      return event.properties.sessionID ?? null;
    case "todo.updated":
      return event.properties.sessionID ?? null;
    case "session.compacted":
    case "session.diff":
    case "session.status":
    case "session.error":
    case "session.idle":
      return event.properties.sessionID ?? null;
    default:
      return getFallbackEventSessionId(event);
  }
}

function getFallbackEventSessionId(event: Event): string | null {
  const properties = (event as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }

  const sessionId = (properties as { sessionID?: unknown }).sessionID;
  return typeof sessionId === "string" ? sessionId : null;
}

function updateRuntimeStatusFromEvent(
  runtime: RuntimeHandle,
  event: Event
): void {
  if (
    event.type === "session.error" &&
    runtime.pendingInterrupt &&
    isSessionErrorAborted(event)
  ) {
    runtime.pendingInterrupt = false;
    setRuntimeStatus(runtime, "awaiting_input");
    return;
  }

  if (runtime.pendingInterrupt && event.type === "message.updated") {
    return;
  }

  const update = resolveRuntimeStatusFromEvent(event);
  if (!update) {
    return;
  }

  setRuntimeStatus(runtime, update.status, update.error);
}

export function resolveRuntimeStatusFromEvent(
  event: Event
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
  const response = await runtime.client.session.messages({
    path: { id: runtime.session.id },
    query: runtime.directoryQuery,
  });

  if (response.error || !response.data) {
    throw new Error(
      getRpcErrorMessage(response.error, "Failed to load agent messages")
    );
  }

  return response.data.map(({ info, parts }) => serializeMessage(info, parts));
}

function serializeMessage(info: Message, parts: Part[]): AgentMessageRecord {
  const contentText = extractTextFromParts(parts);
  const parentId = getMessageParentId(info);
  const errorDetails = getAssistantErrorDetails(info);
  const isAborted = isMessageAbortedError(errorDetails);
  const abortedErrorPayload = isAborted
    ? extractRpcErrorPayload(errorDetails)
    : null;

  return {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    content: contentText.length ? contentText : null,
    parts,
    state: determineMessageState(info),
    createdAt: new Date(info.time.created).toISOString(),
    parentId,
    errorName: isAborted ? (errorDetails?.name ?? null) : null,
    errorMessage: isAborted
      ? (abortedErrorPayload?.data?.message ??
        abortedErrorPayload?.message ??
        null)
      : null,
  };
}

function extractTextFromParts(parts: Part[] | undefined): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "reasoning") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function determineMessageState(message: Message): AgentMessageState {
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
      : { modelId: runtime.modelId, modelProviderId: runtime.providerId };

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

function resolveRuntimeModeFromEvent(event: Event): AgentMode | undefined {
  if (event.type !== "message.updated") {
    return;
  }

  const info = event.properties.info;
  if (info.role !== "assistant") {
    return;
  }

  return normalizeAgentMode(info.mode);
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
  event: Event
): void {
  const nextMode = resolveRuntimeModeFromEvent(event);
  if (!nextMode) {
    return;
  }

  setRuntimeMode(runtime, nextMode);
}

function resolveCompactionCount(event: Event, previousCount: number): number {
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

function recordCompactionEvent(runtime: RuntimeHandle, event: Event): void {
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

function extractErrorMessage(event: Event): string {
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

function isSessionErrorAborted(event: Event): boolean {
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
    data?: { name?: string; message?: string };
    errors?: Array<{ name?: string }>;
  };
  if (candidate.name === "MessageAbortedError") {
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

function isSessionMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not found") || normalized.includes("unknown session")
  );
}

async function deleteRemoteOpencodeSession(args: {
  sessionId: string;
  directoryQuery: DirectoryQuery;
  client?: OpencodeClient;
}): Promise<void> {
  const client =
    args.client ??
    (await getAgentRuntimeDependencies().acquireOpencodeClient());
  const response = await client.session
    .delete({
      path: { id: args.sessionId },
      query: args.directoryQuery,
    })
    .catch((error: unknown) => ({ error }));

  if (!response.error) {
    return;
  }

  const message = getRpcErrorMessage(
    response.error,
    "Failed to delete OpenCode session during runtime shutdown"
  );
  if (isSessionMissingError(message)) {
    return;
  }

  process.stderr.write(
    `[agent] Failed to delete OpenCode session ${args.sessionId}: ${message}\n`
  );
}

async function getCellById(id: string): Promise<Cell | null> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const [cell] = await runtimeDb
    .select()
    .from(cells)
    .where(eq(cells.id, id))
    .limit(1);
  return cell ?? null;
}

async function getCellBySessionId(sessionId: string): Promise<Cell | null> {
  const { db: runtimeDb } = getAgentRuntimeDependencies();
  const [cell] = await runtimeDb
    .select()
    .from(cells)
    .where(eq(cells.opencodeSessionId, sessionId))
    .limit(1);
  return cell ?? null;
}
