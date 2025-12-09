import { base, en, Faker } from "@faker-js/faker";
import type { Page, Route } from "@playwright/test";
import type { AgentMessage } from "@/queries/agents";
import type { CellDiffResponse, DiffMode } from "@/queries/cells";
import type { ModelListResponse } from "@/queries/models";
import type {
  WorkspaceBrowseResponse,
  WorkspaceListResponse,
} from "@/queries/workspaces";
import {
  type CellDiffFixture,
  type CellFixture,
  type CellServiceFixture,
  cellDiffSnapshotFixture,
  cellServiceSnapshotFixture,
  cellSnapshotFixture,
} from "./cell-fixture";
import {
  type TemplateFixture,
  templateSnapshotFixture,
} from "./template-fixture";

const EXAMPLE_FIXTURE_SEED = 20_251_110;

const exampleFaker = new Faker({ locale: [en, base] });

exampleFaker.seed(EXAMPLE_FIXTURE_SEED);

const exampleStatus = {
  message: exampleFaker.hacker.phrase(),
};

export type AgentEventStreamEntry = {
  event?: string;
  data: unknown;
};

type AgentMessagesMap = Record<string, AgentMessage[]>;

const defaultAgentEvents: AgentEventStreamEntry[] = [
  { event: "history", data: { messages: [] } },
  { event: "status", data: { status: "idle" } },
];

const defaultAgentMessages: AgentMessagesMap = {};

const SESSION_ID_SEGMENT_INDEX = 3;
const SESSION_PREFIX_REGEX = /^session-/;
const SESSION_TIMESTAMP_ISO = "2025-01-01T00:00:00.000Z";

const modelCatalogFixture: ModelListResponse = {
  models: [
    {
      id: "gpt-5.1-codex-high",
      name: "GPT 5.1 Codex High",
      provider: "openai",
    },
    {
      id: "gpt-5.1-codex-low",
      name: "GPT 5.1 Codex Low",
      provider: "openai",
    },
  ],
  defaults: {
    openai: "gpt-5.1-codex-high",
  },
  providers: [{ id: "openai", name: "OpenAI" }],
};

const workspaceListFixture: WorkspaceListResponse = {
  workspaces: [
    {
      id: "workspace-primary",
      label: "hive",
      path: "/home/aureatus/dev/projects/hive",
      addedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      lastOpenedAt: new Date("2024-01-02T00:00:00Z").toISOString(),
    },
    {
      id: "workspace-side",
      label: "demo-service",
      path: "/home/aureatus/dev/projects/demo-service",
      addedAt: new Date("2024-01-03T00:00:00Z").toISOString(),
    },
  ],
  activeWorkspaceId: "workspace-primary",
};

const workspaceBrowseFixture: WorkspaceBrowseResponse = {
  path: "/home/aureatus/dev/projects",
  parentPath: "/home/aureatus/dev",
  directories: [
    {
      name: "hive",
      path: "/home/aureatus/dev/projects/hive",
      hasConfig: true,
    },
    {
      name: "demo-service",
      path: "/home/aureatus/dev/projects/demo-service",
      hasConfig: false,
    },
    {
      name: "sandbox",
      path: "/home/aureatus/dev/projects/sandbox",
      hasConfig: false,
    },
  ],
};

const CONSTRUCT_DETAIL_PATTERN = /\/api\/cells\/[^/]+$/;
const CONSTRUCT_DIFF_ROUTE_PATTERN = /\/api\/cells\/[^/]+\/diff(?:\?.*)?$/;
const WORKSPACE_LIST_PATTERN = /\/api\/workspaces(?:\?.*)?$/;
const WORKSPACE_BROWSE_PATTERN = /\/api\/workspaces\/browse(?:\?.*)?$/;

const API_ROUTE_PATTERNS: (string | RegExp)[] = [
  "**/api/cells/*/services",
  CONSTRUCT_DIFF_ROUTE_PATTERN,
  CONSTRUCT_DETAIL_PATTERN,
  "**/api/cells*",
  WORKSPACE_LIST_PATTERN,
  WORKSPACE_BROWSE_PATTERN,
  "**/api/templates/*",
  "**/api/templates*",
  "**/api/example",
  "**/api/agents/models",
  "**/api/agents/sessions/**",
];

const CONSTRUCT_SERVICES_REGEX = /\/api\/cells\/[^/]+\/services$/;
const CONSTRUCT_DIFF_REGEX = /\/api\/cells\/[^/]+\/diff$/;
const AGENT_EVENTS_REGEX = /\/api\/agents\/sessions\/.+\/events$/;

const API_ROUTE_MATCHERS = [
  {
    description: "GET /api/cells",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/cells",
  },
  {
    description: "GET /api/cells/:id/services",
    match: (url: URL, method: string) =>
      method === "GET" && CONSTRUCT_SERVICES_REGEX.test(url.pathname),
  },
  {
    description: "GET /api/cells/:id/diff",
    match: (url: URL, method: string) =>
      method === "GET" && CONSTRUCT_DIFF_REGEX.test(url.pathname),
  },
  {
    description: "GET /api/cells/:id",
    match: (url: URL, method: string) =>
      method === "GET" && CONSTRUCT_DETAIL_PATTERN.test(url.pathname),
  },
  {
    description: "GET /api/workspaces",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/workspaces",
  },
  {
    description: "GET /api/workspaces/browse",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/workspaces/browse",
  },

  {
    description: "GET /api/templates",

    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/templates",
  },
  {
    description: "GET /api/templates/:id",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname.startsWith("/api/templates/"),
  },
  {
    description: "GET /api/example",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/example",
  },
  {
    description: "GET /api/agents/models",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/agents/models",
  },
  {
    description: "GET /api/agents/sessions/byCell/:id",
    match: (url: URL, method: string) =>
      method === "GET" &&
      url.pathname.startsWith("/api/agents/sessions/byCell/"),
  },
  {
    description: "GET /api/agents/sessions/:id/events",
    match: (url: URL, method: string) =>
      method === "GET" && AGENT_EVENTS_REGEX.test(url.pathname),
  },
] as const;

const apiGuardedPages = new WeakSet<Page>();

export type MockApiData = {
  cells: CellFixture[];
  templates: TemplateFixture[];
  services: Record<string, CellServiceFixture[]>;
  diffs: CellDiffFixture;
  example: typeof exampleStatus;
  workspaceList: WorkspaceListResponse;
  workspaceBrowse: WorkspaceBrowseResponse;
  modelCatalog: ModelListResponse;
  agentMessages: AgentMessagesMap;
  agentEvents: AgentEventStreamEntry[];
};

const defaultMockData: MockApiData = {
  cells: cellSnapshotFixture,
  templates: templateSnapshotFixture,
  services: cellServiceSnapshotFixture,
  diffs: cellDiffSnapshotFixture,
  example: exampleStatus,
  workspaceList: workspaceListFixture,
  workspaceBrowse: workspaceBrowseFixture,
  modelCatalog: modelCatalogFixture,
  agentMessages: defaultAgentMessages,
  agentEvents: defaultAgentEvents,
};

export type MockApiOverrides = Partial<MockApiData>;

export async function mockAppApi(
  page: Page,
  overrides: MockApiOverrides = {}
): Promise<MockApiData> {
  await ensureApiGuard(page);
  await resetMockApiRoutes(page);

  const mockData: MockApiData = {
    cells: overrides.cells ?? defaultMockData.cells,
    templates: overrides.templates ?? defaultMockData.templates,
    services: overrides.services ?? defaultMockData.services,
    diffs: overrides.diffs ?? defaultMockData.diffs,
    example: overrides.example ?? defaultMockData.example,
    workspaceList: overrides.workspaceList ?? defaultMockData.workspaceList,
    workspaceBrowse:
      overrides.workspaceBrowse ?? defaultMockData.workspaceBrowse,
    modelCatalog: overrides.modelCatalog ?? defaultMockData.modelCatalog,
    agentMessages: overrides.agentMessages ?? defaultAgentMessages,
    agentEvents: overrides.agentEvents ?? defaultAgentEvents,
  };

  await page.route("**/api/cells*", createCellRouteHandler(mockData));
  await page.route(
    "**/api/cells/*/services",
    createCellServicesHandler(mockData)
  );
  await page.route(
    CONSTRUCT_DIFF_ROUTE_PATTERN,
    createCellDiffHandler(mockData)
  );
  await page.route(CONSTRUCT_DETAIL_PATTERN, createCellDetailHandler(mockData));
  await page.route(
    WORKSPACE_LIST_PATTERN,
    createWorkspaceListHandler(mockData)
  );
  await page.route(
    WORKSPACE_BROWSE_PATTERN,
    createWorkspaceBrowseHandler(mockData)
  );

  await page.route("**/api/templates/*", createTemplateDetailHandler(mockData));
  await page.route("**/api/templates*", createTemplateListHandler(mockData));
  await page.route("**/api/example", createExampleRouteHandler(mockData));
  await page.route(
    "**/api/agents/sessions/byCell/*",
    createAgentSessionByCellHandler()
  );
  await page.route(
    "**/api/agents/sessions/*/messages",
    createAgentMessagesHandler(mockData)
  );
  await page.route(
    "**/api/agents/sessions/*/events",
    createAgentEventStreamHandler(mockData)
  );
  await page.route(
    "**/api/agents/sessions/*/model",
    createAgentSessionModelUpdateHandler()
  );
  await page.route(
    "**/api/agents/sessions/*/models",
    createAgentSessionModelsHandler(mockData)
  );
  await page.route("**/api/agents/models", createModelCatalogHandler(mockData));

  return mockData;
}

async function resetMockApiRoutes(page: Page) {
  for (const pattern of API_ROUTE_PATTERNS) {
    try {
      await page.unroute(pattern);
    } catch {
      // Route might not be registered yet
    }
  }
}

async function ensureApiGuard(page: Page) {
  if (apiGuardedPages.has(page)) {
    return;
  }

  apiGuardedPages.add(page);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const isAllowed = API_ROUTE_MATCHERS.some((matcher) =>
      matcher.match(url, method)
    );

    if (isAllowed) {
      await route.fallback();
      return;
    }

    throw new Error(
      `Unhandled API request in Playwright test: ${method} ${url.pathname}. ` +
        "Add a mock in apps/web/e2e/utils/mock-api.ts or update API_ROUTE_MATCHERS."
    );
  });
}

function createCellRouteHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => ({
    body: { cells: mockData.cells },
  }));
}

function createCellDetailHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const cellId = segments.at(2);

    if (!cellId) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    const cell = mockData.cells.find((entry) => entry.id === cellId);

    if (!cell) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    return { body: cell };
  });
}

function createCellDiffHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const cellId = segments.at(2);

    if (!cellId) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    const diff = mockData.diffs[cellId];
    if (!diff) {
      return {
        status: 404,
        body: { message: "Diff not found" },
      };
    }

    const modeParam = requestUrl.searchParams.get("mode");
    const filesParam = requestUrl.searchParams.get("files");
    const requestedFiles = filesParam
      ? filesParam
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];

    const nextDiff: CellDiffResponse = {
      ...diff,
      mode: (modeParam as DiffMode) ?? diff.mode,
      details:
        requestedFiles.length > 0
          ? diff.details?.filter((detail) =>
              requestedFiles.includes(detail.path)
            )
          : undefined,
    };

    return { body: nextDiff };
  });
}

function createCellServicesHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const cellId = segments.at(2);

    if (!cellId) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    const cellExists = mockData.cells.some((cell) => cell.id === cellId);

    if (!cellExists) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    return {
      body: {
        services: mockData.services[cellId] ?? [],
      },
    };
  });
}

function createWorkspaceListHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => ({ body: mockData.workspaceList }));
}

function createWorkspaceBrowseHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const url = new URL(request.url());
    const pathParam = url.searchParams.get("path");
    const requestedPath = pathParam === null ? undefined : pathParam;
    const rawFilter = url.searchParams.get("filter");
    const normalizedFilter = rawFilter?.toLowerCase().trim();
    const directories = normalizedFilter
      ? mockData.workspaceBrowse.directories.filter((entry) =>
          entry.name.toLowerCase().includes(normalizedFilter)
        )
      : mockData.workspaceBrowse.directories;

    return {
      body: {
        ...mockData.workspaceBrowse,
        path: requestedPath ?? mockData.workspaceBrowse.path,
        directories,
      },
    };
  });
}

function createTemplateListHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => {
    const primaryAgent = mockData.templates[0]?.configJson.agent;
    return {
      body: {
        templates: mockData.templates,
        defaults: {
          templateId: mockData.templates[0]?.id,
        },
        agentDefaults: {
          providerId: primaryAgent?.providerId ?? "openai",
          modelId: primaryAgent?.modelId ?? "gpt-5.1-codex-high",
        },
      },
    };
  });
}

function createTemplateDetailHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const templateId = segments.at(-1);

    const template = mockData.templates.find(
      (entry) => entry.id === templateId
    );
    if (!template) {
      return {
        status: 404,
        body: { message: "Template not found" },
      };
    }

    return { body: template };
  });
}

function createExampleRouteHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => ({ body: mockData.example }));
}

function createAgentSessionByCellHandler() {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const cellId = segments.at(-1);

    if (!cellId) {
      return {
        status: 404,
        body: { message: "Cell not found" },
      };
    }

    return {
      body: {
        session: {
          id: `session-${cellId}`,
          status: "awaiting_input",
        },
      },
    };
  });
}

function createAgentMessagesHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const sessionId = segments.at(SESSION_ID_SEGMENT_INDEX);

    if (!sessionId) {
      return {
        status: 404,
        body: { message: "Session not found" },
      };
    }

    return {
      body: {
        messages: mockData.agentMessages[sessionId] ?? [],
      },
    };
  });
}

function createAgentEventStreamHandler(mockData: MockApiData) {
  return async (route: Route) => {
    await route.fulfill({
      status: 200,
      body: serializeEventStream(mockData.agentEvents),
      headers: {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      },
    });
  };
}

function createAgentSessionModelUpdateHandler() {
  return async (route: Route) => {
    if (route.request().method() !== "PATCH") {
      return route.continue();
    }
    const requestUrl = new URL(route.request().url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const sessionId = segments.at(SESSION_ID_SEGMENT_INDEX) ?? "session-mock";
    const cellId =
      sessionId.replace(SESSION_PREFIX_REGEX, "") || "snapshot-cell";
    const timestamp = new Date(SESSION_TIMESTAMP_ISO).toISOString();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: sessionId,
        cellId,
        templateId: "hive-dev",
        provider: "openai",
        status: "awaiting_input",
        workspacePath: `/home/hive/.hive/cells/${cellId}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    });
  };
}

function createAgentSessionModelsHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => ({
    body: mockData.modelCatalog,
  }));
}

function createModelCatalogHandler(mockData: MockApiData) {
  return async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockData.modelCatalog),
    });
  };
}

function serializeEventStream(entries: AgentEventStreamEntry[]): string {
  if (entries.length === 0) {
    return "data: {}\n\n";
  }
  return `${entries
    .map((entry) => {
      const lines: string[] = [];
      if (entry.event) {
        lines.push(`event: ${entry.event}`);
      }
      const payload =
        typeof entry.data === "string"
          ? entry.data
          : JSON.stringify(entry.data);
      lines.push(`data: ${payload}`);
      return lines.join("\n");
    })
    .join("\n\n")}\n\n`;
}

type RouteRequest = ReturnType<Route["request"]>;

function createGetJsonHandler(
  resolve: (request: RouteRequest) =>
    | {
        status?: number;
        body: unknown;
        contentType?: string;
      }
    | Promise<{
        status?: number;
        body: unknown;
        contentType?: string;
      }>
) {
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    const {
      status = 200,
      body,
      contentType = "application/json",
    } = await resolve(route.request());

    await route.fulfill({
      status,
      contentType,
      body: JSON.stringify(body),
    });
  };
}
