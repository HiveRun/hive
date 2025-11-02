import type { Page } from "@playwright/test";

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("vite-ui-theme", selectedTheme);
  }, theme);
}
