import { expect, test } from "@playwright/test";

import { setTheme } from "./utils/theme";

const SAMPLE_CONSTRUCTS = [
  {
    id: "construct-1",
    templateId: "full-stack-dev",
    name: "Full Stack Sandbox",
    description: "Sample development workspace",
    type: "implementation",
    status: "active",
    workspacePath: "/workspaces/sample",
    constructPath: "/workspaces/sample/.constructs/construct-1",
    createdAt: "2024-10-01T09:00:00.000Z",
    updatedAt: "2024-10-01T11:30:00.000Z",
    completedAt: null,
    metadata: null,
  },
  {
    id: "construct-2",
    templateId: "planning",
    name: "Planning Session",
    description: "Design exploration sprint",
    type: "planning",
    status: "awaiting_input",
    workspacePath: "/workspaces/sample",
    constructPath: "/workspaces/sample/.constructs/construct-2",
    createdAt: "2024-09-20T14:00:00.000Z",
    updatedAt: "2024-09-20T15:45:00.000Z",
    completedAt: null,
    metadata: null,
  },
  {
    id: "construct-3",
    templateId: "manual",
    name: "Manual Workspace",
    description: "Blank environment for experiments",
    type: "manual",
    status: "draft",
    workspacePath: "/workspaces/sample",
    constructPath: "/workspaces/sample/.constructs/construct-3",
    createdAt: "2024-08-05T10:15:00.000Z",
    updatedAt: "2024-08-05T10:15:00.000Z",
    completedAt: null,
    metadata: null,
  },
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/constructs*", async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SAMPLE_CONSTRUCTS),
    });
  });
});

test.describe("Homepage - Visual Snapshots", () => {
  test("should match homepage snapshot (light mode)", async ({ page }) => {
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (dark mode)", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    await expect(page).toHaveScreenshot("homepage-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (tablet)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-tablet.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
