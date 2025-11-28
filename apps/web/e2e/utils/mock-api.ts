import { base, en, Faker } from "@faker-js/faker";
import type { Page, Route } from "@playwright/test";
import type { ConstructDiffResponse, DiffMode } from "@/queries/constructs";
import type {
  WorkspaceBrowseResponse,
  WorkspaceListResponse,
} from "@/queries/workspaces";
import {
  type ConstructDiffFixture,
  type ConstructFixture,
  type ConstructServiceFixture,
  constructDiffSnapshotFixture,
  constructServiceSnapshotFixture,
  constructSnapshotFixture,
} from "./construct-fixture";
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

const CONSTRUCT_DETAIL_PATTERN = /\/api\/constructs\/[^/]+$/;
const CONSTRUCT_DIFF_ROUTE_PATTERN = /\/api\/constructs\/[^/]+\/diff(?:\?.*)?$/;
const WORKSPACE_LIST_PATTERN = /\/api\/workspaces(?:\?.*)?$/;
const WORKSPACE_BROWSE_PATTERN = /\/api\/workspaces\/browse(?:\?.*)?$/;

const API_ROUTE_PATTERNS: (string | RegExp)[] = [
  "**/api/constructs/*/services",
  CONSTRUCT_DIFF_ROUTE_PATTERN,
  CONSTRUCT_DETAIL_PATTERN,
  "**/api/constructs*",
  WORKSPACE_LIST_PATTERN,
  WORKSPACE_BROWSE_PATTERN,
  "**/api/templates/*",
  "**/api/templates*",
  "**/api/example",
  "**/api/agents/sessions/**",
];

const CONSTRUCT_SERVICES_REGEX = /\/api\/constructs\/[^/]+\/services$/;
const CONSTRUCT_DIFF_REGEX = /\/api\/constructs\/[^/]+\/diff$/;
const AGENT_EVENTS_REGEX = /\/api\/agents\/sessions\/.+\/events$/;

const API_ROUTE_MATCHERS = [
  {
    description: "GET /api/constructs",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/constructs",
  },
  {
    description: "GET /api/constructs/:id/services",
    match: (url: URL, method: string) =>
      method === "GET" && CONSTRUCT_SERVICES_REGEX.test(url.pathname),
  },
  {
    description: "GET /api/constructs/:id/diff",
    match: (url: URL, method: string) =>
      method === "GET" && CONSTRUCT_DIFF_REGEX.test(url.pathname),
  },
  {
    description: "GET /api/constructs/:id",
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
    description: "GET /api/agents/sessions/byConstruct/:id",
    match: (url: URL, method: string) =>
      method === "GET" &&
      url.pathname.startsWith("/api/agents/sessions/byConstruct/"),
  },
  {
    description: "GET /api/agents/sessions/:id/events",
    match: (url: URL, method: string) =>
      method === "GET" && AGENT_EVENTS_REGEX.test(url.pathname),
  },
] as const;

const apiGuardedPages = new WeakSet<Page>();

export type MockApiData = {
  constructs: ConstructFixture[];
  templates: TemplateFixture[];
  services: Record<string, ConstructServiceFixture[]>;
  diffs: ConstructDiffFixture;
  example: typeof exampleStatus;
  workspaceList: WorkspaceListResponse;
  workspaceBrowse: WorkspaceBrowseResponse;
};

const defaultMockData: MockApiData = {
  constructs: constructSnapshotFixture,
  templates: templateSnapshotFixture,
  services: constructServiceSnapshotFixture,
  diffs: constructDiffSnapshotFixture,
  example: exampleStatus,
  workspaceList: workspaceListFixture,
  workspaceBrowse: workspaceBrowseFixture,
};

export type MockApiOverrides = Partial<MockApiData>;

export async function mockAppApi(
  page: Page,
  overrides: MockApiOverrides = {}
): Promise<MockApiData> {
  await ensureApiGuard(page);
  await resetMockApiRoutes(page);

  const mockData: MockApiData = {
    constructs: overrides.constructs ?? defaultMockData.constructs,
    templates: overrides.templates ?? defaultMockData.templates,
    services: overrides.services ?? defaultMockData.services,
    diffs: overrides.diffs ?? defaultMockData.diffs,
    example: overrides.example ?? defaultMockData.example,
    workspaceList: overrides.workspaceList ?? defaultMockData.workspaceList,
    workspaceBrowse:
      overrides.workspaceBrowse ?? defaultMockData.workspaceBrowse,
  };

  await page.route("**/api/constructs*", createConstructRouteHandler(mockData));
  await page.route(
    "**/api/constructs/*/services",
    createConstructServicesHandler(mockData)
  );
  await page.route(
    CONSTRUCT_DIFF_ROUTE_PATTERN,
    createConstructDiffHandler(mockData)
  );
  await page.route(
    CONSTRUCT_DETAIL_PATTERN,
    createConstructDetailHandler(mockData)
  );
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
    "**/api/agents/sessions/byConstruct/*",
    createAgentSessionByConstructHandler()
  );
  await page.route(
    "**/api/agents/sessions/*/events",
    createAgentEventStreamHandler()
  );

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

function createConstructRouteHandler(mockData: MockApiData) {
  return createGetJsonHandler(() => ({
    body: { constructs: mockData.constructs },
  }));
}

function createConstructDetailHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const constructId = segments.at(2);

    if (!constructId) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    const construct = mockData.constructs.find(
      (entry) => entry.id === constructId
    );

    if (!construct) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    return { body: construct };
  });
}

function createConstructDiffHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const constructId = segments.at(2);

    if (!constructId) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    const diff = mockData.diffs[constructId];
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

    const nextDiff: ConstructDiffResponse = {
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

function createConstructServicesHandler(mockData: MockApiData) {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const constructId = segments.at(2);

    if (!constructId) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    const constructExists = mockData.constructs.some(
      (construct) => construct.id === constructId
    );

    if (!constructExists) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    return {
      body: {
        services: mockData.services[constructId] ?? [],
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
    const requestedPath = url.searchParams.get("path") ?? undefined;
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
  return createGetJsonHandler(() => ({
    body: {
      templates: mockData.templates,
      defaults: {
        templateId: mockData.templates[0]?.id,
      },
    },
  }));
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

function createAgentSessionByConstructHandler() {
  return createGetJsonHandler((request) => {
    const requestUrl = new URL(request.url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const constructId = segments.at(-1);

    if (!constructId) {
      return {
        status: 404,
        body: { message: "Construct not found" },
      };
    }

    return {
      body: {
        session: {
          id: `session-${constructId}`,
          status: "awaiting_input",
        },
      },
    };
  });
}

function createAgentEventStreamHandler() {
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    const historyPayload = JSON.stringify({ messages: [] });
    const statusPayload = JSON.stringify({ status: "awaiting_input" });
    const body = [
      "event: history",
      `data: ${historyPayload}`,
      "",
      "event: status",
      `data: ${statusPayload}`,
      "",
    ].join("\n");

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        connection: "keep-alive",
        "cache-control": "no-cache",
      },
      body,
    });
  };
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
