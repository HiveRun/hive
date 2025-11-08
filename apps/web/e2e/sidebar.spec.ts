import { expect, test } from "./utils/app-test";

const DESKTOP_VIEWPORT = { width: 1280, height: 960 } as const;

const SIDEBAR_TOGGLE_LABEL = /toggle sidebar/i;

test.describe("Sidebar Behaviour", () => {
  test("theme toggle remains visible when sidebar collapses", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto("/example-dashboard");
    await page.waitForLoadState("networkidle");

    const sidebarToggle = page.getByRole("button", {
      name: SIDEBAR_TOGGLE_LABEL,
    });
    await expect(sidebarToggle).toBeVisible();

    await sidebarToggle.click();

    await expect(
      page.getByRole("button", { name: SIDEBAR_TOGGLE_LABEL })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle theme" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Example Dashboard" })
    ).toBeVisible();
  });
});
