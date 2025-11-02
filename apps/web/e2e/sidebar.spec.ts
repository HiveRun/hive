import { expect, test } from "@playwright/test";

test.describe("Sidebar Behaviour", () => {
  test("theme toggle remains visible when sidebar collapses", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto("/example-dashboard");
    await page.waitForLoadState("networkidle");

    const sidebarToggle = page.getByRole("button", { name: "Toggle sidebar" });
    await expect(sidebarToggle).toBeVisible();

    await sidebarToggle.click();

    await expect(
      page.getByRole("button", { name: "Toggle theme" })
    ).toBeVisible();
  });
});
