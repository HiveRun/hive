import { Elysia } from "elysia";
import {
  resolveWorkspaceContext as defaultResolveWorkspaceContext,
  type WorkspaceRuntimeContext,
} from "./context";

const HTTP_STATUS = {
  BAD_REQUEST: 400,
} as const;

class WorkspaceContextResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceContextResolutionError";
  }
}

const hasWorkspaceId = (value: unknown): value is { workspaceId?: unknown } =>
  typeof value === "object" && value !== null && "workspaceId" in value;

const extractWorkspaceId = (value: unknown): string | undefined => {
  if (!hasWorkspaceId(value)) {
    return;
  }

  const identifier = value.workspaceId;
  return typeof identifier === "string" && identifier.length > 0
    ? identifier
    : undefined;
};

export type WorkspaceContextFetcher = (
  workspaceId?: string
) => Promise<WorkspaceRuntimeContext>;

export function createWorkspaceContextPlugin({
  resolveWorkspaceContext,
}: {
  resolveWorkspaceContext?: typeof defaultResolveWorkspaceContext;
} = {}) {
  const resolveContext =
    resolveWorkspaceContext ?? defaultResolveWorkspaceContext;

  return new Elysia({ name: "workspace-context" })
    .derive(({ body, query, params, request }) => {
      let cachedPromise: Promise<WorkspaceRuntimeContext> | null = null;
      let cachedFor: string | undefined | null = null;

      const inferWorkspaceId = (explicit?: string) => {
        const headerId = request?.headers?.get("x-workspace-id") ?? undefined;
        const candidates = [
          explicit,
          extractWorkspaceId(query),
          extractWorkspaceId(body),
          extractWorkspaceId(params),
          headerId,
        ];

        return candidates.find(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.length > 0
        );
      };

      const getWorkspaceContext: WorkspaceContextFetcher = (workspaceId) => {
        const resolvedId = inferWorkspaceId(workspaceId);
        if (!cachedPromise || cachedFor !== resolvedId) {
          cachedFor = resolvedId ?? null;
          cachedPromise = resolveContext(resolvedId).catch((error) => {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to resolve workspace context";
            throw new WorkspaceContextResolutionError(message);
          });
        }

        return cachedPromise;
      };

      return { getWorkspaceContext };
    })
    .onError(({ error, set }) => {
      if (error instanceof WorkspaceContextResolutionError) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: error.message };
      }
    })
    .as("scoped");
}
