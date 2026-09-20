import { rpc } from "@/lib/rpc";
import { formatRpcError, formatRpcResponseError } from "@/lib/rpc-error";

type ProviderAuthListResult = Awaited<
  ReturnType<typeof rpc.api.agents.integrations.get>
>;

type ProviderAuthCatalog = Extract<
  NonNullable<ProviderAuthListResult["data"]>,
  { integrations: unknown }
>;
export type ProviderAuthIntegration =
  ProviderAuthCatalog["integrations"][number];
export type ProviderAuthMethod = ProviderAuthIntegration["methods"][number];

function requireRpcData<T>(
  result: { data: T | null | undefined; error: unknown },
  fallbackMessage: string
): NonNullable<T> {
  if (result.error) {
    throw new Error(formatRpcError(result.error, fallbackMessage));
  }
  const { data } = result;
  if (data == null) {
    throw new Error(formatRpcResponseError(null, fallbackMessage));
  }
  return data as NonNullable<T>;
}

const providerOAuthAttempt = (integrationId: string, attemptId: string) =>
  rpc.api.agents.integrations({ integrationId }).oauth({ attemptId });
const providerCommandAttempt = (integrationId: string, attemptId: string) =>
  rpc.api.agents.integrations({ integrationId }).command({ attemptId });

function providerAttemptStatusQuery<T>(options: {
  workspaceId: string;
  integrationId: string;
  attemptId: string;
  kind: "oauth" | "command";
  load: () => Promise<{ data: T | null; error: unknown }>;
  fallbackMessage: string;
}) {
  return {
    queryKey: [
      "provider-auth",
      options.workspaceId,
      options.integrationId,
      options.kind,
      options.attemptId,
    ] as const,
    queryFn: async () =>
      requireRpcData(await options.load(), options.fallbackMessage),
  };
}

async function cancelProviderAttempt<T>(options: {
  cancel: () => Promise<{ data: T | null; error: unknown }>;
  fallbackMessage: string;
}) {
  requireRpcData(await options.cancel(), options.fallbackMessage);
}

function providerAttemptStatusQueryFactory<T>(options: {
  kind: "oauth" | "command";
  load: (
    workspaceId: string,
    integrationId: string,
    attemptId: string
  ) => Promise<{ data: T | null; error: unknown }>;
  fallbackMessage: string;
}) {
  return (workspaceId: string, integrationId: string, attemptId: string) =>
    providerAttemptStatusQuery({
      workspaceId,
      integrationId,
      attemptId,
      kind: options.kind,
      load: () => options.load(workspaceId, integrationId, attemptId),
      fallbackMessage: options.fallbackMessage,
    });
}

type ProviderAttemptMutationInput = {
  workspaceId: string;
  integrationId: string;
  attemptId: string;
};

function providerAttemptCancelMutation<T>(options: {
  cancel: (
    input: ProviderAttemptMutationInput
  ) => Promise<{ data: T | null; error: unknown }>;
  fallbackMessage: string;
}) {
  return {
    mutationFn: (input: ProviderAttemptMutationInput) =>
      cancelProviderAttempt({
        cancel: () => options.cancel(input),
        fallbackMessage: options.fallbackMessage,
      }),
  };
}

export const providerAuthQueries = {
  byWorkspace: (workspaceId: string) => ({
    queryKey: ["provider-auth", workspaceId] as const,
    queryFn: async (): Promise<ProviderAuthCatalog> =>
      requireRpcData(
        await rpc.api.agents.integrations.get({ query: { workspaceId } }),
        "Failed to load provider connections"
      ),
  }),
  oauthStatus: providerAttemptStatusQueryFactory({
    kind: "oauth",
    load: (workspaceId, integrationId, attemptId) =>
      rpc.api.agents
        .integrations({ integrationId })
        .oauth({ attemptId })
        .get({ query: { workspaceId } }),
    fallbackMessage: "Failed to check provider authentication",
  }),
  commandStatus: providerAttemptStatusQueryFactory({
    kind: "command",
    load: (workspaceId, integrationId, attemptId) =>
      providerCommandAttempt(integrationId, attemptId).get({
        query: { workspaceId },
      }),
    fallbackMessage: "Failed to check provider connection command",
  }),
};

export const providerAuthMutations = {
  connectKey: {
    mutationFn: async (input: {
      workspaceId: string;
      integrationId: string;
      key: string;
      answer?: Record<string, string | number | boolean | string[]>;
    }): Promise<void> => {
      requireRpcData(
        await rpc.api.agents
          .integrations({ integrationId: input.integrationId })
          .key.post({
            workspaceId: input.workspaceId,
            key: input.key,
            ...(input.answer ? { answer: input.answer } : {}),
          }),
        "Failed to connect provider"
      );
    },
  },
  startOAuth: {
    mutationFn: async (input: {
      workspaceId: string;
      integrationId: string;
      methodId: string;
      answer?: Record<string, string | number | boolean | string[]>;
    }) =>
      requireRpcData(
        await rpc.api.agents
          .integrations({ integrationId: input.integrationId })
          .oauth.post({
            workspaceId: input.workspaceId,
            methodId: input.methodId,
            ...(input.answer ? { answer: input.answer } : {}),
          }),
        "Failed to start provider authentication"
      ),
  },
  completeOAuth: {
    mutationFn: async (input: {
      workspaceId: string;
      integrationId: string;
      attemptId: string;
      code?: string;
    }): Promise<void> => {
      requireRpcData(
        await providerOAuthAttempt(
          input.integrationId,
          input.attemptId
        ).complete.post({
          workspaceId: input.workspaceId,
          ...(input.code ? { code: input.code } : {}),
        }),
        "Failed to complete provider authentication"
      );
    },
  },
  cancelOAuth: providerAttemptCancelMutation({
    cancel: (input) =>
      providerOAuthAttempt(input.integrationId, input.attemptId).delete({
        query: { workspaceId: input.workspaceId },
      }),
    fallbackMessage: "Failed to cancel provider authentication",
  }),
  startCommand: {
    mutationFn: async (input: {
      workspaceId: string;
      integrationId: string;
      methodId: string;
    }) =>
      requireRpcData(
        await rpc.api.agents
          .integrations({ integrationId: input.integrationId })
          .command.post({
            workspaceId: input.workspaceId,
            methodId: input.methodId,
          }),
        "Failed to start provider connection command"
      ),
  },
  cancelCommand: providerAttemptCancelMutation({
    cancel: (input) =>
      providerCommandAttempt(input.integrationId, input.attemptId).delete({
        query: { workspaceId: input.workspaceId },
      }),
    fallbackMessage: "Failed to cancel provider connection command",
  }),
};
