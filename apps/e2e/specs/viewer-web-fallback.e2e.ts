import { expect, test } from "@playwright/test";
import { createCell } from "../src/test-helpers";

test.describe("viewer route in web runtime", () => {
  test("shows a desktop-only message instead of embedding a preview", async ({
    page,
  }) => {
    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `Viewer Web Fallback ${Date.now()}`,
    });

    await page.goto(`/cells/${cellId}/viewer`);

    await expect(page.getByTestId("cell-viewer-route")).toBeVisible();
    await expect(page.getByTestId("viewer-desktop-only-message")).toBeVisible();
    await expect(
      page.getByText("Browser preview now uses Electron directly.")
    ).toBeVisible();
  });
});
