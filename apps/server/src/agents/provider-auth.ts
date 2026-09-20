import type {
  FormField,
  IntegrationInfo,
  OpenCodeClient,
  ProviderInfo,
} from "@opencode-ai/client";
import { acquireSharedOpencodeClient } from "./opencode-server";

type ProviderConnectionState = "connected" | "missing" | "not_required";
type ProviderAuthNumber = number | "Infinity" | "-Infinity" | "NaN";

type ProviderAuthFormField = {
  key: string;
  type: FormField["type"];
  title?: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  url?: string;
  when?: Array<{
    key: string;
    op: "eq" | "neq";
    value: string | number | boolean;
  }>;
  default?: string | number | boolean | string[];
  minimum?: ProviderAuthNumber;
  maximum?: ProviderAuthNumber;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: "email" | "uri" | "date" | "date-time";
  custom?: boolean;
};

type ProviderAuthMethod = {
  type: "key" | "oauth" | "command" | "env";
  id?: string;
  label: string;
  fields: ProviderAuthFormField[];
  environmentVariables?: string[];
};

type ProviderAuthIntegration = {
  id: string;
  name: string;
  connected: boolean;
  connectionLabels: string[];
  methods: ProviderAuthMethod[];
};

type ProviderAuthStatus = {
  id: string;
  name: string;
  integrationId: string | null;
  state: ProviderConnectionState;
};

type ProviderAuthCatalog = {
  integrations: ProviderAuthIntegration[];
  providers: ProviderAuthStatus[];
};

const locationFor = (workspacePath: string) => ({
  location: { directory: workspacePath },
});

function sanitizeFormField(field: FormField): ProviderAuthFormField {
  return {
    ...field,
    ...("when" in field && field.when
      ? { when: field.when.map((condition) => ({ ...condition })) }
      : {}),
    ...("options" in field && field.options
      ? { options: field.options.map((option) => ({ ...option })) }
      : {}),
    ...("default" in field && Array.isArray(field.default)
      ? { default: [...field.default] }
      : {}),
  };
}

function sanitizeMethod(
  method: IntegrationInfo["methods"][number]
): ProviderAuthMethod | null {
  if (method.type === "command") {
    return {
      type: "command",
      id: method.id,
      label: method.label,
      fields: [],
    };
  }
  if (method.type === "env") {
    return {
      type: "env",
      label: "Environment variables",
      fields: [],
      environmentVariables: method.names,
    };
  }
  return {
    type: method.type,
    ...(method.type === "oauth" ? { id: method.id } : {}),
    label: method.label ?? (method.type === "key" ? "API key" : "OAuth"),
    fields: (method.form ?? []).map(sanitizeFormField),
  };
}

function sanitizeIntegration(
  integration: IntegrationInfo
): ProviderAuthIntegration {
  return {
    id: integration.id,
    name: integration.name,
    connected: integration.connections.length > 0,
    connectionLabels: integration.connections.map((connection) =>
      connection.type === "credential" ? connection.label : connection.name
    ),
    methods: integration.methods
      .map(sanitizeMethod)
      .filter((method): method is ProviderAuthMethod => method !== null),
  };
}

function resolveProviderStatus(
  provider: ProviderInfo,
  integrations: Map<string, IntegrationInfo>
): ProviderAuthStatus {
  const integrationId = provider.integrationID ?? provider.id;
  const integration = integrations.get(integrationId);
  const requiresConnection = Boolean(
    provider.integrationID || integration?.methods.length
  );
  let state: ProviderConnectionState = "not_required";
  if (integration?.connections.length) {
    state = "connected";
  } else if (requiresConnection) {
    state = "missing";
  }

  return {
    id: provider.id,
    name: provider.name,
    integrationId: integration?.id ?? provider.integrationID ?? null,
    state,
  };
}

export async function fetchProviderAuthCatalog(
  workspacePath: string,
  client?: OpenCodeClient
): Promise<ProviderAuthCatalog> {
  const opencode = client ?? (await acquireSharedOpencodeClient());
  const location = locationFor(workspacePath);
  const [providerResult, integrationResult] = await Promise.all([
    opencode.provider.list(location),
    opencode.integration.list(location),
  ]);
  const integrationsById = new Map(
    integrationResult.data.map((integration) => [integration.id, integration])
  );

  return {
    integrations: integrationResult.data.map(sanitizeIntegration),
    providers: providerResult.data.map((provider) =>
      resolveProviderStatus(provider, integrationsById)
    ),
  };
}

export async function assertProviderConnected(options: {
  providerId: string | undefined;
  provider?: ProviderInfo;
  workspacePath: string;
  client?: OpenCodeClient;
}): Promise<void> {
  if (!options.providerId) {
    return;
  }
  const opencode = options.client ?? (await acquireSharedOpencodeClient());
  const location = locationFor(options.workspacePath);
  const provider =
    options.provider ??
    (await opencode.provider.list(location)).data.find(
      (candidate) => candidate.id === options.providerId
    );
  if (!provider) {
    return;
  }
  const integrations = await opencode.integration.list(location);
  const status = resolveProviderStatus(
    provider,
    new Map(
      integrations.data.map((integration) => [integration.id, integration])
    )
  );
  if (status.state !== "missing") {
    return;
  }

  throw new Error(
    `Provider "${status.name}" is not connected. Connect it in Hive Settings before starting an agent session.`
  );
}

type ProviderConnectionOptions = {
  workspacePath: string;
  integrationId: string;
  client?: OpenCodeClient;
};

type ProviderConnectionAnswers = {
  answer?: Record<string, string | number | boolean | readonly string[]>;
  label?: string;
};

type ProviderOAuthAttemptOptions = ProviderConnectionOptions & {
  attemptId: string;
};

function connectionRequest(
  options: ProviderConnectionOptions & ProviderConnectionAnswers
) {
  return {
    integrationID: options.integrationId,
    ...locationFor(options.workspacePath),
    ...(options.answer ? { answer: options.answer } : {}),
    ...(options.label ? { label: options.label } : {}),
  };
}

export async function connectProviderKey(
  options: ProviderConnectionOptions &
    ProviderConnectionAnswers & { key: string }
): Promise<void> {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  await client.integration.connect.key({
    ...connectionRequest(options),
    key: options.key,
  });
}

export async function startProviderOAuth(
  options: ProviderConnectionOptions &
    ProviderConnectionAnswers & { methodId: string }
) {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  return await client.integration.oauth.connect({
    ...connectionRequest(options),
    methodID: options.methodId,
  });
}

export async function fetchProviderOAuthStatus(
  options: ProviderOAuthAttemptOptions
) {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  return await client.integration.oauth.status({
    integrationID: options.integrationId,
    attemptID: options.attemptId,
    ...locationFor(options.workspacePath),
  });
}

export async function completeProviderOAuth(
  options: ProviderOAuthAttemptOptions & { code?: string }
): Promise<void> {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  await client.integration.oauth.complete({
    integrationID: options.integrationId,
    attemptID: options.attemptId,
    ...locationFor(options.workspacePath),
    ...(options.code ? { code: options.code } : {}),
  });
}

export async function cancelProviderOAuth(
  options: ProviderOAuthAttemptOptions
): Promise<void> {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  await client.integration.oauth.cancel({
    integrationID: options.integrationId,
    attemptID: options.attemptId,
    ...locationFor(options.workspacePath),
  });
}

export async function startProviderCommand(
  options: ProviderConnectionOptions & { methodId: string; label?: string }
) {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  return await client.integration.command.connect({
    integrationID: options.integrationId,
    methodID: options.methodId,
    ...locationFor(options.workspacePath),
    ...(options.label ? { label: options.label } : {}),
  });
}

export async function fetchProviderCommandStatus(
  options: ProviderOAuthAttemptOptions
) {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  return await client.integration.command.status({
    integrationID: options.integrationId,
    attemptID: options.attemptId,
    ...locationFor(options.workspacePath),
  });
}

export async function cancelProviderCommand(
  options: ProviderOAuthAttemptOptions
): Promise<void> {
  const client = options.client ?? (await acquireSharedOpencodeClient());
  await client.integration.command.cancel({
    integrationID: options.integrationId,
    attemptID: options.attemptId,
    ...locationFor(options.workspacePath),
  });
}
