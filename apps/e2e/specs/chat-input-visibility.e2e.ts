import { test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  waitForChatRoute,
  waitForCondition,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_TEMPLATE_LABEL = "Basic Template";

test.describe("chat input visibility", () => {
  test("shows terminal activity while typing and remains interactive after Enter", async ({
    page,
  }) => {
    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Chat Draft ${Date.now()}`,
      templateLabel: CHAT_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);
    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });
    await waitForChatRoute({ page, cellId, timeoutMs: CHAT_ROUTE_TIMEOUT_MS });

    const textarea = page.locator(selectors.terminalInputTextarea).first();
    await textarea.focus();

    const terminalRoot = page.locator(selectors.terminalRoot).first();
    const beforeSeq = await terminalRoot.getAttribute(
      "data-terminal-output-seq"
    );

    await page.keyboard.type("visible draft", { delay: 25 });

    await waitForCondition({
      timeoutMs: 10_000,
      errorMessage: "Terminal did not react to typing before Enter",
      check: async () => {
        const currentSeq = await terminalRoot
          .getAttribute("data-terminal-output-seq")
          .catch(() => null);

        return Number(currentSeq ?? "0") > Number(beforeSeq ?? "0");
      },
    });

    const beforeEnterSeq = await terminalRoot.getAttribute(
      "data-terminal-output-seq"
    );

    await page.keyboard.press("Enter");

    await waitForCondition({
      timeoutMs: 10_000,
      errorMessage: "Terminal did not remain interactive after Enter",
      check: async () => {
        const currentSeq = await terminalRoot
          .getAttribute("data-terminal-output-seq")
          .catch(() => null);

        return Number(currentSeq ?? "0") > Number(beforeEnterSeq ?? "0");
      },
    });
  });
});
