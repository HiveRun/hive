import { expect, test } from "@playwright/test";

const STORY_CASES = [
  {
    id: "features-provisioningchecklistpanel--in-progress",
    snapshot: "provisioning-in-progress.png",
  },
  {
    id: "features-provisioningchecklistpanel--completed",
    snapshot: "provisioning-completed.png",
  },
  {
    id: "features-provisioningchecklistpanel--failed",
    snapshot: "provisioning-failed.png",
  },
  {
    id: "features-webpreview--default",
    snapshot: "web-preview-default.png",
  },
  {
    id: "features-webpreview--loading",
    snapshot: "web-preview-loading.png",
  },
  {
    id: "features-webpreview--empty",
    snapshot: "web-preview-empty.png",
  },
  {
    id: "features-webpreview--error-state",
    snapshot: "web-preview-error.png",
  },
] as const;

for (const storyCase of STORY_CASES) {
  test(`story ${storyCase.id}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${storyCase.id}&viewMode=story`);

    await page.waitForSelector("#storybook-root > *", {
      state: "visible",
    });

    await expect(page.locator("#storybook-root")).toHaveScreenshot(
      storyCase.snapshot,
      {
        maxDiffPixelRatio: 0.01,
      }
    );
  });
}
