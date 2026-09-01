import { expect, type Page, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 640, label: "phone-short", width: 360 },
  { height: 844, label: "phone-tall", width: 390 },
  { height: 1024, label: "tablet-portrait", width: 768 },
  { height: 768, label: "tablet-landscape", width: 1024 },
  { height: 1375, label: "reported-portrait", width: 1100 },
  { height: 720, label: "laptop", width: 1280 },
  { height: 768, label: "common-laptop", width: 1366 },
  { height: 900, label: "desktop", width: 1440 },
  { height: 1080, label: "wide-desktop", width: 1920 },
] as const;
const MICROPHONE_SCENARIO = /Browser microphone/;
const MICROPHONE_STEP_ZERO_URL = /scenario=microphone&step=0/;
const MICROPHONE_STEP_ONE_URL = /scenario=microphone&step=1/;
const MICROPHONE_FAULT_URL =
  /fault=true&returnStep=1&scenario=microphone&step=1&tour=explore/;
const GUIDED_COLD_START_URL = /scenario=cold-start&step=0&tour=guided/;
const EXPLORE_COLD_START_URL = /scenario=cold-start&step=0&tour=explore/;
const HIVE_FOCUS_NODES = /Focus nodes · HIVE/;
const GUIDED_BOOT_FAULT_URL =
  /fault=true&returnStep=0&scenario=cold-start&step=2&tour=guided/;
const TOTAL_GUIDE_CHECKPOINTS = 26;
const FIRST_MICROPHONE_CHECKPOINT_INDEX = 6;

test.describe("Android Runtime Lab", () => {
  test.beforeEach(async ({ page }) => {
    await installRuntimeLabFixtures(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("vite-ui-theme", "dark");
    });
  });

  test("keeps every panel contained across the viewport matrix", async ({
    page,
  }, testInfo) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/android-runtime?tour=explore");
      await expect(
        page.getByRole("heading", { name: "Android Runtime Lab" })
      ).toBeVisible();
      await page
        .getByTestId("runtime-lab-scroll")
        .evaluate((element) => element.scrollTo(0, 0));

      const screenshotPath = testInfo.outputPath(`${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach(viewport.label, {
        contentType: "image/png",
        path: screenshotPath,
      });

      await page
        .getByTestId("runtime-topology-canvas")
        .scrollIntoViewIfNeeded();

      const geometry = await readRuntimeLabGeometry(page);
      expect(
        geometry.body.scrollWidth,
        `${viewport.label}: body must not scroll horizontally`
      ).toBeLessThanOrEqual(geometry.body.clientWidth);
      expect(
        geometry.scroll.scrollWidth,
        `${viewport.label}: lab must not scroll horizontally`
      ).toBeLessThanOrEqual(geometry.scroll.clientWidth);
      expect(
        geometry.scenarios.scrollWidth,
        `${viewport.label}: scenarios must fit without a native scrollbar`
      ).toBeLessThanOrEqual(geometry.scenarios.clientWidth);
      expect(
        geometry.nodes.every((node) => node.contained),
        `${viewport.label}: every topology node must remain inside the canvas`
      ).toBe(true);
      expect(
        geometry.nodes.every((node) => node.centerClickable),
        `${viewport.label}: every topology node center must be clickable`
      ).toBe(true);
      expect(
        geometry.nodeOverlaps,
        `${viewport.label}: topology nodes must not overlap`
      ).toEqual([]);
      expect(
        geometry.canvas.bottom <= geometry.eventPlaque.top,
        `${viewport.label}: the event plaque must not cover the topology`
      ).toBe(true);
      expect(
        geometry.overlaps.workbenchInspector,
        `${viewport.label}: workbench and inspector must not overlap`
      ).toBe(false);
      expect(
        geometry.overlaps.scenariosWorkbench,
        `${viewport.label}: scenarios and workbench must not overlap`
      ).toBe(false);
      expect(
        geometry.unexpectedScrollOwners,
        `${viewport.label}: the lab must have one deliberate vertical scroll owner`
      ).toEqual([]);
      expect(
        geometry.documentScrolls,
        `${viewport.label}: the document itself must remain fixed`
      ).toBe(false);

      const labScroll = page.getByTestId("runtime-lab-scroll");
      const scrollTopBefore = await labScroll.evaluate(
        (element) => element.scrollTop
      );
      await page
        .getByRole("button", { name: "Product guardian, standby" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Product guardian", level: 2 })
      ).toBeVisible();
      await page.getByTestId("runtime-inspector").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("runtime-inspector")).toBeVisible();
      const scrollTopAfter = await labScroll.evaluate(
        (element) => element.scrollTop
      );
      if (geometry.scroll.scrollHeight > geometry.scroll.clientHeight) {
        expect(
          scrollTopAfter,
          `${viewport.label}: inspector navigation must move the lab scroller`
        ).toBeGreaterThanOrEqual(scrollTopBefore);
      }
    }
  });

  test("guides a first-time visitor through every checkpoint", async ({
    page,
  }, testInfo) => {
    for (const viewport of [
      { height: 844, label: "guide-phone", width: 390 },
      { height: 900, label: "guide-desktop", width: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/android-runtime");

      await expect(page.getByTestId("runtime-briefing")).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Understand the Android runtime by watching it move",
        })
      ).toBeVisible();
      await expect(page.getByText("How the tour works")).toBeVisible();
      const briefingPath = testInfo.outputPath(
        `${viewport.label}-briefing.png`
      );
      await page.screenshot({ path: briefingPath });
      await testInfo.attach(`${viewport.label}-briefing`, {
        contentType: "image/png",
        path: briefingPath,
      });

      await page.getByRole("button", { name: "Start guided tour" }).click();
      await expect(page).toHaveURL(GUIDED_COLD_START_URL);
      await expect(page.getByTestId("runtime-guide")).toBeVisible();
      await expect(
        page.getByText(
          `Guided tour · Checkpoint 1 of ${TOTAL_GUIDE_CHECKPOINTS}`
        )
      ).toBeVisible();
      await expect(page.getByText(HIVE_FOCUS_NODES)).toBeVisible();
      const guidedPath = testInfo.outputPath(`${viewport.label}-guided.png`);
      await page.screenshot({ path: guidedPath });
      await testInfo.attach(`${viewport.label}-guided`, {
        contentType: "image/png",
        path: guidedPath,
      });

      await page.getByRole("button", { name: "Next checkpoint" }).click();
      await expect(
        page.getByText(
          `Guided tour · Checkpoint 2 of ${TOTAL_GUIDE_CHECKPOINTS}`
        )
      ).toBeVisible();
      await page.goBack();
      await expect(
        page.getByText(
          `Guided tour · Checkpoint 1 of ${TOTAL_GUIDE_CHECKPOINTS}`
        )
      ).toBeVisible();

      await page.getByRole("button", { name: "Show failure" }).click();
      await expect(page).toHaveURL(GUIDED_BOOT_FAULT_URL);
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: "Failure branch: Emulator never completes boot",
        })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Next checkpoint" })
      ).toBeDisabled();
      await page.getByRole("button", { name: "Return to path" }).click();
      await expect(page).toHaveURL(GUIDED_COLD_START_URL);

      for (
        let checkpoint = 1;
        checkpoint < TOTAL_GUIDE_CHECKPOINTS;
        checkpoint += 1
      ) {
        await page.getByRole("button", { name: "Next checkpoint" }).click();
        await expect(
          page.getByText(
            `Guided tour · Checkpoint ${checkpoint + 1} of ${TOTAL_GUIDE_CHECKPOINTS}`
          )
        ).toBeVisible();
        if (checkpoint === FIRST_MICROPHONE_CHECKPOINT_INDEX) {
          await expect(
            page.getByText("Scenario 2 of 5 · Browser microphone")
          ).toBeVisible();
          await page.getByRole("button", { name: "Back" }).click();
          await expect(
            page.getByText(
              `Guided tour · Checkpoint 6 of ${TOTAL_GUIDE_CHECKPOINTS}`
            )
          ).toBeVisible();
          await expect(
            page.getByText("Scenario 1 of 5 · Cold start")
          ).toBeVisible();
          await page.getByRole("button", { name: "Next checkpoint" }).click();
          await expect(
            page.getByText(
              `Guided tour · Checkpoint 7 of ${TOTAL_GUIDE_CHECKPOINTS}`
            )
          ).toBeVisible();
        }
      }

      await expect(
        page.getByRole("heading", {
          name: "Tour complete: Execute scoped command",
        })
      ).toBeVisible();
      await expect(
        page.getByText(
          `You have now followed all five scenarios and ${TOTAL_GUIDE_CHECKPOINTS} checkpoints.`
        )
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review from start" })
      ).toBeVisible();
      await page.getByRole("button", { name: "Review from start" }).click();
      await expect(page).toHaveURL(GUIDED_COLD_START_URL);

      await page.getByRole("button", { name: "Exit guide" }).click();
      await expect(page).toHaveURL(EXPLORE_COLD_START_URL);
      await expect(
        page.getByRole("button", { name: "Start guide" })
      ).toBeVisible();
    }
  });

  test("runs scenarios, steps, faults, playback, and node inspection", async ({
    page,
  }) => {
    for (const viewport of [
      { height: 844, width: 390 },
      { height: 900, width: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/android-runtime?tour=explore");

      await page.getByRole("button", { name: MICROPHONE_SCENARIO }).click();
      await expect(page).toHaveURL(MICROPHONE_STEP_ZERO_URL);
      await page.getByRole("button", { name: "02 Request microphone" }).click();
      await expect(page).toHaveURL(MICROPHONE_STEP_ONE_URL);

      await page.getByRole("button", { name: "Deny permission" }).click();
      await expect(page).toHaveURL(MICROPHONE_FAULT_URL);
      await page.getByTestId("runtime-inspector").scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("heading", { name: "Microphone approval denied" })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Play scenario" })
      ).toBeDisabled();
      await page
        .getByTestId("runtime-topology-canvas")
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", { name: "Browser or Electron, blocked" })
      ).toBeVisible();

      await page.getByRole("button", { name: "Deny permission" }).click();
      await expect(page).toHaveURL(MICROPHONE_STEP_ONE_URL);
      await page.getByRole("button", { name: "Reset scenario" }).click();
      await expect(page).toHaveURL(MICROPHONE_STEP_ZERO_URL);

      await page.getByRole("button", { name: "Play scenario" }).click();
      await expect(
        page.getByRole("button", { name: "Pause scenario" })
      ).toBeVisible();
      await expect(page).toHaveURL(MICROPHONE_STEP_ONE_URL, {
        timeout: 5000,
      });
    }
  });
});

async function installRuntimeLabFixtures(page: Page) {
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        activeWorkspaceId: "runtime-lab-workspace",
        workspaces: [
          {
            addedAt: "2026-08-13T00:00:00.000Z",
            id: "runtime-lab-workspace",
            label: "Runtime Lab",
            path: "/tmp/runtime-lab",
          },
        ],
      },
    });
  });
  await page.route("**/api/cells?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { cells: [] },
    });
  });
}

function readRuntimeLabGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) {
        throw new Error("Expected Runtime Lab element was not rendered");
      }
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    };
    const overlaps = (
      first: ReturnType<typeof box>,
      second: ReturnType<typeof box>
    ) =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top;

    const scroll = document.querySelector('[data-testid="runtime-lab-scroll"]');
    const scenarios = document.querySelector(
      '[data-testid="runtime-scenario-rail"]'
    );
    const workbench = document.querySelector(
      '[data-testid="runtime-workbench"]'
    );
    const inspector = document.querySelector(
      '[data-testid="runtime-inspector"]'
    );
    const canvas = document.querySelector(
      '[data-testid="runtime-topology-canvas"]'
    );
    const eventPlaque = document.querySelector(
      '[data-testid="runtime-event-plaque"]'
    );
    if (
      !(scroll && scenarios && workbench && inspector && canvas && eventPlaque)
    ) {
      throw new Error("Runtime Lab layout is incomplete");
    }

    const canvasBox = box(canvas);
    const scenarioBox = box(scenarios);
    const workbenchBox = box(workbench);
    const inspectorBox = box(inspector);
    const nodeBoxes = Array.from(canvas.querySelectorAll("button")).map(
      (node) => ({
        box: box(node),
        label: node.getAttribute("aria-label") ?? "unknown node",
        node,
      })
    );
    const nodeOverlaps = nodeBoxes.flatMap((left, leftIndex) =>
      nodeBoxes
        .slice(leftIndex + 1)
        .filter((right) => overlaps(left.box, right.box))
        .map((right) => `${left.label} / ${right.label}`)
    );
    const unexpectedScrollOwners = Array.from(
      document.querySelectorAll("section *")
    )
      .filter((element) => {
        const overflowY = getComputedStyle(element).overflowY;
        return (
          element !== scroll &&
          (overflowY === "auto" || overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map(
        (element) =>
          element.getAttribute("data-testid") ?? element.tagName.toLowerCase()
      );

    return {
      body: {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
      },
      canvas: canvasBox,
      eventPlaque: box(eventPlaque),
      inspector: inspectorBox,
      documentScrolls:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight + 1,
      nodeOverlaps,
      nodes: nodeBoxes.map(({ box: nodeBox, node }) => {
        const center = document.elementFromPoint(
          (nodeBox.left + nodeBox.right) / 2,
          (nodeBox.top + nodeBox.bottom) / 2
        );
        return {
          centerClickable: center === node || node.contains(center),
          contained:
            nodeBox.left >= canvasBox.left &&
            nodeBox.right <= canvasBox.right &&
            nodeBox.top >= canvasBox.top &&
            nodeBox.bottom <= canvasBox.bottom,
        };
      }),
      overlaps: {
        scenariosWorkbench: overlaps(scenarioBox, workbenchBox),
        workbenchInspector: overlaps(workbenchBox, inspectorBox),
      },
      scenarios: {
        clientWidth: scenarios.clientWidth,
        scrollWidth: scenarios.scrollWidth,
      },
      scroll: {
        clientHeight: scroll.clientHeight,
        clientWidth: scroll.clientWidth,
        scrollHeight: scroll.scrollHeight,
        scrollWidth: scroll.scrollWidth,
      },
      unexpectedScrollOwners,
    };
  });
}
