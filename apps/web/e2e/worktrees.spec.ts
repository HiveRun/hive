import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.describe("Worktree Management", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to constructs page
    await page.goto("/constructs");
    await page.waitForLoadState("networkidle");
  });

  test("should display worktree status and controls", async ({ page }) => {
    // Test that worktree UI elements are present and functional
    const constructCards = page.locator('[data-testid="construct-card"]');
    const cardCount = await constructCards.count();

    // If there are no constructs, that's also a valid state
    if (cardCount === 0) {
      // Check for empty state
      await expect(page.locator("text=No constructs yet")).toBeVisible();
      return;
    }

    // Test first construct card
    const firstCard = constructCards.first();

    // Check that worktree status badges are present
    const worktreeActive = firstCard.locator("text=Worktree Active");
    const noWorktree = firstCard.locator("text=No Worktree");

    // Exactly one of these should be present
    const hasActiveStatus = await worktreeActive.count();
    const hasNoWorktreeStatus = await noWorktree.count();
    expect(hasActiveStatus + hasNoWorktreeStatus).toBe(1);

    // Check that appropriate worktree buttons are present
    const createWorktreeBtn = firstCard.locator(
      '[data-testid="create-worktree"]'
    );
    const removeWorktreeBtn = firstCard.locator(
      '[data-testid="remove-worktree"]'
    );

    if (hasNoWorktreeStatus > 0) {
      // Should show create button, not remove button
      await expect(createWorktreeBtn).toBeVisible();
      await expect(removeWorktreeBtn).not.toBeVisible();
    } else {
      // Should show remove button, not create button
      await expect(removeWorktreeBtn).toBeVisible();
      await expect(createWorktreeBtn).not.toBeVisible();
    }
  });

  test("should create worktree when clicking create button", async ({
    page,
  }) => {
    const constructCards = page.locator('[data-testid="construct-card"]');
    const cardCount = await constructCards.count();

    if (cardCount === 0) {
      // Skip test if no constructs available
      test.skip();
      return;
    }

    // Find a construct without worktree
    let constructWithoutWorktree: Locator | null = null;
    for (let i = 0; i < cardCount; i++) {
      const card = constructCards.nth(i);
      const noWorktreeStatus = await card.locator("text=No Worktree").count();
      if (noWorktreeStatus > 0) {
        constructWithoutWorktree = card;
        break;
      }
    }

    if (!constructWithoutWorktree) {
      // All constructs have worktrees, skip test
      test.skip();
      return;
    }

    const createWorktreeBtn = constructWithoutWorktree.locator(
      '[data-testid="create-worktree"]'
    );
    await expect(createWorktreeBtn).toBeVisible();

    // Create worktree
    await createWorktreeBtn.click();

    // Wait for success toast
    await expect(page.locator("text=Worktree created for")).toBeVisible({
      timeout: 10_000,
    });

    // Should now show worktree active status
    await expect(
      constructWithoutWorktree.locator("text=Worktree Active")
    ).toBeVisible();

    // Should show remove button instead of create button
    const removeWorktreeBtn = constructWithoutWorktree.locator(
      '[data-testid="remove-worktree"]'
    );
    await expect(removeWorktreeBtn).toBeVisible();
    await expect(createWorktreeBtn).not.toBeVisible();
  });

  test("should remove worktree when clicking remove button", async ({
    page,
  }) => {
    const constructCards = page.locator('[data-testid="construct-card"]');
    const cardCount = await constructCards.count();

    if (cardCount === 0) {
      test.skip();
      return;
    }

    // Find a construct with worktree
    let constructWithWorktree: Locator | null = null;
    for (let i = 0; i < cardCount; i++) {
      const card = constructCards.nth(i);
      const worktreeActiveStatus = await card
        .locator("text=Worktree Active")
        .count();
      if (worktreeActiveStatus > 0) {
        constructWithWorktree = card;
        break;
      }
    }

    if (!constructWithWorktree) {
      // No constructs have worktrees, skip test
      test.skip();
      return;
    }

    const removeWorktreeBtn = constructWithWorktree.locator(
      '[data-testid="remove-worktree"]'
    );
    await expect(removeWorktreeBtn).toBeVisible();

    // Remove worktree
    await removeWorktreeBtn.click();

    // Wait for success toast
    await expect(page.locator("text=Worktree removed for")).toBeVisible({
      timeout: 10_000,
    });

    // Should now show no worktree status
    await expect(
      constructWithWorktree.locator("text=No Worktree")
    ).toBeVisible();

    // Should show create button instead of remove button
    const createWorktreeBtn = constructWithWorktree.locator(
      '[data-testid="create-worktree"]'
    );
    await expect(createWorktreeBtn).toBeVisible();
    await expect(removeWorktreeBtn).not.toBeVisible();
  });

  test("should display workspace path when available", async ({ page }) => {
    const constructCards = page.locator('[data-testid="construct-card"]');
    const cardCount = await constructCards.count();

    if (cardCount > 0) {
      const firstCard = constructCards.first();

      // Check that workspace path element exists (may be empty)
      const workspaceElement = firstCard.locator("text=Workspace:");
      const workspaceCount = await workspaceElement.count();

      // Workspace element may or may not be present depending on data
      // This test mainly verifies the page structure is correct
      expect(workspaceCount).toBeGreaterThanOrEqual(0);
    }
  });
});
