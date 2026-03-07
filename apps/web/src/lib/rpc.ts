import { getApiBase } from "@/lib/api-base";

const API_URL = getApiBase();

type QueryValue = string | number | boolean | null | undefined;

type QueryParams = Record<string, QueryValue>;

type RpcError = {
  message: string;
  value?: unknown;
};

type RpcResult<T> = Promise<{
  data: T;
  error: RpcError | null;
}>;

type RequestOptions<TBody = unknown> = {
  query?: QueryParams;
  body?: TBody;
};

export type CreateCellInput = {
  workspaceId: string;
  templateId: string;
  name: string;
  description?: string;
  providerId?: string;
  modelId?: string;
  startMode?: "plan" | "build";
  spawnFromMode?: "head" | "branch" | "pr";
  spawnFromValue?: string;
};

const buildUrl = (path: string, query?: QueryParams) => {
  const url = new URL(path, API_URL);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

const buildError = async (response: Response): Promise<RpcError> => {
  const payload = await response
    .json()
    .catch(() => ({ message: response.statusText }));

  const message =
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
      ? payload.message
      : response.statusText || "Request failed";

  return {
    message,
    value: payload,
  };
};

const request = async <TResponse = unknown, TBody = unknown>(
  method: string,
  path: string,
  options?: RequestOptions<TBody>
): RpcResult<TResponse> => {
  const response = await fetch(buildUrl(path, options?.query), {
    method,
    headers:
      options?.body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
          },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    return {
      data: null as TResponse,
      error: await buildError(response),
    };
  }

  const data = (await response.json().catch(() => null)) as TResponse;
  return { data, error: null };
};

const get = <TResponse = unknown>(path: string, query?: QueryParams) =>
  request<TResponse>("GET", path, { query });

const post = <TResponse = unknown, TBody = unknown>(
  path: string,
  body?: TBody
) => request<TResponse, TBody>("POST", path, { body });

const del = <TResponse = unknown, TBody = unknown>(
  path: string,
  bodyOrOptions?: TBody | { query?: QueryParams }
) => {
  if (
    bodyOrOptions &&
    typeof bodyOrOptions === "object" &&
    "query" in bodyOrOptions
  ) {
    return request<TResponse>("DELETE", path, {
      query: bodyOrOptions.query,
    });
  }

  return request<TResponse, TBody>("DELETE", path, {
    body: bodyOrOptions as TBody | undefined,
  });
};

const cellRoutes = (id: string) => ({
  get: (options?: { query?: QueryParams }) =>
    get(`/api/cells/${id}`, options?.query),
  delete: () => del(`/api/cells/${id}`),
  services: Object.assign(
    (serviceParams: { serviceId: string }) => ({
      start: {
        post: () =>
          post(`/api/cells/${id}/services/${serviceParams.serviceId}/start`),
      },
      stop: {
        post: () =>
          post(`/api/cells/${id}/services/${serviceParams.serviceId}/stop`),
      },
    }),
    {
      get: (options?: { query?: QueryParams }) =>
        get(`/api/cells/${id}/services`, options?.query),
      start: {
        post: () => post(`/api/cells/${id}/services/start`),
      },
      stop: {
        post: () => post(`/api/cells/${id}/services/stop`),
      },
    }
  ),
  resources: {
    get: (options?: { query?: QueryParams }) =>
      get(`/api/cells/${id}/resources`, options?.query),
  },
  activity: {
    get: (options?: { query?: QueryParams }) =>
      get(`/api/cells/${id}/activity`, options?.query),
  },
  timings: {
    get: (options?: { query?: QueryParams }) =>
      get(`/api/cells/${id}/timings`, options?.query),
  },
  diff: {
    get: (options?: { query?: QueryParams }) =>
      get(`/api/cells/${id}/diff`, options?.query),
  },
  setup: {
    retry: {
      post: () => post(`/api/cells/${id}/setup/retry`),
    },
  },
});

const workspaceRoutes = (id: string) => ({
  activate: {
    post: () => post(`/api/workspaces/${id}/activate`),
  },
  delete: () => del(`/api/workspaces/${id}`),
});

const templateRoutes = (id: string) => ({
  get: (options?: { query?: QueryParams }) =>
    get(`/api/templates/${id}`, options?.query),
});

const sessionRoutes = (id: string) => ({
  models: {
    get: () => get(`/api/agents/sessions/${id}/models`),
  },
});

export const rpc = {
  api: {
    cells: Object.assign((params: { id: string }) => cellRoutes(params.id), {
      get: (options?: { query?: QueryParams }) =>
        get("/api/cells", options?.query),
      post: (body: CreateCellInput) => post("/api/cells", body),
      delete: (body?: { ids: string[] }) => del("/api/cells", body),
      timings: {
        global: {
          get: (options?: { query?: QueryParams }) =>
            get("/api/cells/timings/global", options?.query),
        },
      },
    }),
    agents: {
      models: {
        get: (options?: { query?: QueryParams }) =>
          get("/api/agents/models", options?.query),
      },
      sessions: Object.assign(
        (params: { id: string }) => sessionRoutes(params.id),
        {
          byCell: (params: { cellId: string }) => ({
            get: () => get(`/api/agents/sessions/byCell/${params.cellId}`),
          }),
        }
      ),
    },
    templates: Object.assign(
      (params: { id: string }) => templateRoutes(params.id),
      {
        get: (options?: { query?: QueryParams }) =>
          get("/api/templates", options?.query),
      }
    ),
    workspaces: Object.assign(
      (params: { id: string }) => workspaceRoutes(params.id),
      {
        get: () => get("/api/workspaces"),
        post: (body: { path: string; label?: string; activate?: boolean }) =>
          post("/api/workspaces", body),
        browse: {
          get: (options?: { query?: QueryParams }) =>
            get("/api/workspaces/browse", options?.query),
        },
      }
    ),
    example: {
      get: () => get("/api/example"),
    },
  },
};
