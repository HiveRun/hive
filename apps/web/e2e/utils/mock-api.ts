import { base, en, Faker } from "@faker-js/faker";
import type { Page, Route } from "@playwright/test";
import {
  type ConstructFixture,
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
  "**/api/constructs",
  "**/api/templates/*",
  "**/api/templates",
  "**/api/example",
] as const;

const API_ROUTE_MATCHERS = [
  {
    description: "GET /api/constructs",
    match: (url: URL, method: string) =>
      method === "GET" && url.pathname === "/api/constructs",
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
] as const;

const apiGuardedPages = new WeakSet<Page>();

type MockApiData = {
  constructs: ConstructFixture[];
  templates: TemplateFixture[];
  example: typeof exampleStatus;
};

const defaultMockData: MockApiData = {
  constructs: constructSnapshotFixture,
  templates: templateSnapshotFixture,
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
    example: overrides.example ?? defaultMockData.example,
  };

  await page.route("**/api/constructs", createConstructRouteHandler(mockData));
  await page.route("**/api/templates/*", createTemplateDetailHandler(mockData));
  await page.route("**/api/templates", createTemplateListHandler(mockData));
  await page.route("**/api/example", createExampleRouteHandler(mockData));

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
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ constructs: mockData.constructs }),
    });
  };
}

function createTemplateListHandler(mockData: MockApiData) {
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ templates: mockData.templates }),
    });
  };
}

function createTemplateDetailHandler(mockData: MockApiData) {
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    const requestUrl = new URL(route.request().url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const templateId = segments.at(-1);

    const template = mockData.templates.find(
      (entry) => entry.id === templateId
    );
    if (!template) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "Template not found" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(template),
    });
  };
}

function createExampleRouteHandler(mockData: MockApiData) {
  return async (route: Route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockData.example),
    });
  };
}

export type { MockApiData };
