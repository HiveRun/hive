import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { getSharedOpencodeServerBaseUrl } from "../agents/opencode-server";
import { DatabaseService } from "../db";
import { CellOpencodeBootstrapResponseSchema } from "../schema/api";
import { cells } from "../schema/cells";
import {
  buildOpencodeProxyTargetUrl,
  proxyOpencodeRequest,
} from "../services/opencode-proxy";

const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

const ErrorResponseSchema = t.Object({
  message: t.String(),
});

type CellRecord = typeof cells.$inferSelect;

function isCellReadyForOpencodeWeb(cell: CellRecord): boolean {
  return (
    cell.status === "ready" &&
    typeof cell.opencodeSessionId === "string" &&
    cell.opencodeSessionId.length > 0
  );
}

async function loadCellById(cellId: string): Promise<CellRecord | null> {
  const [cell] = await DatabaseService.db
    .select()
    .from(cells)
    .where(eq(cells.id, cellId))
    .limit(1);

  return cell ?? null;
}

function resolveProxyBasePath(cellId: string): string {
  return `/api/cells/${cellId}/opencode/proxy`;
}

function encodeOpencodeDirectorySlug(directory: string): string {
  return Buffer.from(directory, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function resolveOpencodeAppPath(cell: CellRecord): string {
  const directorySlug = encodeOpencodeDirectorySlug(cell.workspacePath);
  const sessionId = cell.opencodeSessionId;
  if (!sessionId) {
    return `/${directorySlug}/session`;
  }
  return `/${directorySlug}/session/${sessionId}`;
}

async function prepareProxyContext(cellId: string): Promise<
  | {
      ok: true;
      cell: CellRecord;
      upstreamBaseUrl: string;
    }
  | { ok: false; status: number; message: string }
> {
  const cell = await loadCellById(cellId);
  if (!cell) {
    return {
      ok: false,
      status: HTTP_STATUS.NOT_FOUND,
      message: "Cell not found",
    };
  }

  if (!isCellReadyForOpencodeWeb(cell)) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: "OpenCode web is unavailable until provisioning completes",
    };
  }

  const upstreamBaseUrl = getSharedOpencodeServerBaseUrl();
  if (!upstreamBaseUrl) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: "Shared OpenCode server is not available",
    };
  }

  return {
    ok: true,
    cell,
    upstreamBaseUrl,
  };
}

async function handleProxyRequest(args: {
  request: Request;
  cellId: string;
  fallbackBody?: unknown;
}): Promise<
  | Response
  | {
      status: number;
      body: { message: string };
    }
> {
  const prepared = await prepareProxyContext(args.cellId);
  if (!prepared.ok) {
    return {
      status: prepared.status,
      body: { message: prepared.message },
    };
  }

  const targetUrl = buildOpencodeProxyTargetUrl({
    requestUrl: args.request.url,
    cellId: args.cellId,
    upstreamBaseUrl: prepared.upstreamBaseUrl,
  });

  return await proxyOpencodeRequest({
    request: args.request,
    targetUrl,
    proxyBasePath: resolveProxyBasePath(args.cellId),
    opencodeDirectory: prepared.cell.workspacePath,
    fallbackBody: args.fallbackBody,
  });
}

export const cellOpencodeRoutes = new Elysia({ prefix: "/api/cells" })
  .get(
    "/:id/opencode/bootstrap",
    async ({ params, set }) => {
      const prepared = await prepareProxyContext(params.id);
      if (!prepared.ok) {
        set.status = prepared.status;
        return { message: prepared.message };
      }

      const sessionId = prepared.cell.opencodeSessionId;
      if (!sessionId) {
        set.status = HTTP_STATUS.CONFLICT;
        return {
          message: "OpenCode session is not available for this cell",
        };
      }

      set.status = HTTP_STATUS.OK;
      return {
        proxyBasePath: resolveProxyBasePath(prepared.cell.id),
        sessionId,
        appPath: resolveOpencodeAppPath(prepared.cell),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: CellOpencodeBootstrapResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    }
  )
  .all(
    "/:id/opencode/proxy/*",
    async ({ params, request, body, set }) => {
      try {
        const result = await handleProxyRequest({
          request,
          cellId: params.id,
          fallbackBody: body,
        });

        if (result instanceof Response) {
          return result;
        }

        set.status = result.status;
        return result.body;
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: route-level fallback until shared logger typing is available
        console.error("OpenCode proxy request failed", {
          cellId: params.id,
          error,
        });
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to proxy OpenCode request" };
      }
    },
    {
      response: {
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    }
  );
