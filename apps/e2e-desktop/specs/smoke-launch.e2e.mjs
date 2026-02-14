import { $, browser, expect } from "@wdio/globals";

const describe = globalThis.describe;
const it = globalThis.it;

if (typeof describe !== "function" || typeof it !== "function") {
  throw new Error("Mocha globals are not available in this WDIO worker");
}

describe("desktop launch smoke", () => {
  it("loads the workspace shell", async () => {
    await browser.url("/");

    await browser.waitUntil(
      async () => {
        const button = await $("[data-testid='workspace-create-cell']");
        return await button.isExisting();
      },
      {
        timeout: 120_000,
        interval: 500,
        timeoutMsg: "Workspace create button did not appear in desktop UI",
      }
    );

    const createCellButton = await $("[data-testid='workspace-create-cell']");
    await expect(createCellButton).toBeDisplayed();
  });
});
