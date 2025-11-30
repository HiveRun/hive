import type { CellDiffResponse } from "@/queries/cells";
import { expect, type Page, test } from "./utils/app-test";
import { cellDiffSnapshotFixture } from "./utils/cell-fixture";
import { type MockApiOverrides, mockAppApi } from "./utils/mock-api";

const API_ERROR_STATUS = 400;

async function openDiffView(
  page: Page,
  options: { file?: string; overrides?: MockApiOverrides } = {}
) {
  page.on("response", (response) => {
    if (
      response.status() >= API_ERROR_STATUS &&
      response.url().includes("/api/cells")
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
  await page.goto(`/cells/snapshot-cell/diff${query}`);
  await page.waitForLoadState("networkidle");
}

const SEMANTIC_WRAP_TOLERANCE = 5;

test.describe("Cell Diff View", () => {
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
    const baseDiff = cellDiffSnapshotFixture["snapshot-cell"];
    if (!baseDiff) {
      throw new Error("Missing diff snapshot for snapshot-cell");
    }
    const patchOnlyDiff: CellDiffResponse = {
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
          ...cellDiffSnapshotFixture,
          "snapshot-cell": patchOnlyDiff,
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
