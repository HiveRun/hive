import type { ConstructDiffResponse } from "@/queries/constructs";
import { expect, type Page, test } from "./utils/app-test";
import { constructDiffSnapshotFixture } from "./utils/construct-fixture";
import { type MockApiOverrides, mockAppApi } from "./utils/mock-api";

const API_ERROR_STATUS = 400;

async function openDiffView(
  page: Page,
  options: { file?: string; overrides?: MockApiOverrides } = {}
) {
  page.on("response", (response) => {
    if (
      response.status() >= API_ERROR_STATUS &&
      response.url().includes("/api/constructs")
    ) {
      console.error(`API ${response.status()} -> ${response.url()}`);
    }
  });
  await mockAppApi(page, options.overrides);
  const params = new URLSearchParams();
  if (options.file) {
    params.set("file", options.file);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  await page.goto(`/constructs/snapshot-construct/diff${query}`);
  await page.waitForLoadState("networkidle");
}

const SEMANTIC_WRAP_TOLERANCE = 5;

test.describe("Construct Diff View", () => {
  test("semantic diff wraps by default", async ({ page }) => {
    await openDiffView(page);
    const diffContainer = page.getByTestId("diff-semantic-view");
    await expect(diffContainer).toBeVisible();
    const measurements = await diffContainer.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(measurements.scrollWidth).toBeLessThanOrEqual(
      measurements.clientWidth + SEMANTIC_WRAP_TOLERANCE
    );
  });

  test("patch fallback wraps output", async ({ page }) => {
    const baseDiff = constructDiffSnapshotFixture["snapshot-construct"];
    const patchOnlyDiff: ConstructDiffResponse = {
      ...baseDiff,
      details:
        baseDiff.details?.map((detail) =>
          detail.path === "README.md"
            ? {
                ...detail,
                beforeContent: undefined,
                afterContent: undefined,
              }
            : detail
        ) ?? [],
    };

    await openDiffView(page, {
      file: "README.md",
      overrides: {
        diffs: {
          ...constructDiffSnapshotFixture,
          "snapshot-construct": patchOnlyDiff,
        },
      },
    });

    const patchPre = page.getByTestId("diff-patch-view").locator("pre");
    await expect(patchPre).toBeVisible();
    const whitespace = await patchPre.evaluate(
      (node) => window.getComputedStyle(node).whiteSpace
    );
    expect(whitespace).toBe("pre-wrap");
  });
});
