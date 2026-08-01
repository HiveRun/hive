import { expect, test } from "@playwright/test";
import { createCellFromHome } from "../src/test-helpers";

const LOOPBACK_VIEWER_URL_PATTERN = /^http:\/\/localhost:/;

test.describe("viewer route in web runtime", () => {
  test("embeds reachable loopback services in a restricted iframe", async ({
    page,
  }) => {
    const cellId = await createCellFromHome({
      page,
      name: `Viewer Web Fallback ${Date.now()}`,
      templateLabel: "Viewer Template",
    });

    await page.goto(`/cells/${cellId}/viewer`);

    await expect(page.getByTestId("cell-viewer-route")).toBeVisible();
    const iframe = page.getByTestId("web-iframe-preview");
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts"
    );
    await expect(iframe).toHaveAttribute("allow", "autoplay; microphone");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(iframe).toHaveAttribute("src", LOOPBACK_VIEWER_URL_PATTERN);
    await expect(iframe.contentFrame().getByRole("heading")).toHaveText(
      "Viewer Web"
    );
    await expect(
      page.getByTestId("viewer-service-tab-web-browser")
    ).toContainText("browser / http");

    await page.getByTestId("viewer-service-tab-docs").click();
    await expect(iframe.contentFrame().getByRole("heading")).toHaveText(
      "Viewer Docs"
    );

    const viewerRoute = page.getByTestId("cell-viewer-route");

    await expect(viewerRoute.getByLabel("Back")).toBeDisabled();
    await expect(viewerRoute.getByLabel("Forward")).toBeDisabled();
    await expect(viewerRoute.getByLabel("Refresh")).toBeDisabled();
    await expect(
      viewerRoute.getByLabel("Reset to service root")
    ).toBeDisabled();
    await expect(viewerRoute.getByLabel("Open externally")).toBeDisabled();
    await expect(viewerRoute.getByLabel("Fullscreen")).toBeDisabled();
  });
});
