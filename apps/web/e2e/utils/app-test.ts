import { test as base } from "@playwright/test";

import {
  type MockApiData,
  type MockApiOverrides,
  mockAppApi,
} from "./mock-api";

export type MockApiFixture = (
  overrides?: MockApiOverrides
) => Promise<MockApiData>;

const test = base.extend<{ mockApi: MockApiFixture }>({
  page: async ({ page }, use) => {
    await mockAppApi(page);
    await use(page);
  },
  mockApi: async ({ page }, use) => {
    await use((overrides = {}) => mockAppApi(page, overrides));
  },
});

const expect = test.expect;

export { expect, test };
export type { Page } from "@playwright/test";
