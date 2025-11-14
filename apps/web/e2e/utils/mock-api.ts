import { base, en, Faker } from "@faker-js/faker";
import type { Page, Route } from "@playwright/test";
import {
  type ConstructFixture,
  type ConstructServiceFixture,
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

const API_ROUTE_PATTERNS = [
  "**/api/constructs/*/services",
  "**/api/constructs",
  "**/api/templates/*",
  "**/api/templates",
  "**/api/example",
  "**/api/agents/sessions/**",
] as const;

const CONSTRUCT_SERVICES_REGEX = /\/api\/constructs\/[^/]+\/services$/;

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
] as const;

const apiGuardedPages = new WeakSet<Page>();

type MockApiData = {
  constructs: ConstructFixture[];
  templates: TemplateFixture[];
  services: Record<string, ConstructServiceFixture[]>;
  example: typeof exampleStatus;
};

const defaultMockData: MockApiData = {
  constructs: constructSnapshotFixture,
  templates: templateSnapshotFixture,
  services: constructServiceSnapshotFixture,
  example: exampleStatus,
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
    example: overrides.example ?? defaultMockData.example,
  };

  await page.route("**/api/constructs", createConstructRouteHandler(mockData));
  await page.route(
    "**/api/constructs/*/services",
    createConstructServicesHandler(mockData)
  );
  await page.route("**/api/templates/*", createTemplateDetailHandler(mockData));
  await page.route("**/api/templates", createTemplateListHandler(mockData));
  await page.route("**/api/example", createExampleRouteHandler(mockData));
  await page.route(
    "**/api/agents/sessions/byConstruct/*",
    createAgentSessionByConstructHandler()
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

export type { MockApiData };
