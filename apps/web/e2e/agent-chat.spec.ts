import type { AgentMessage } from "@/queries/agents";
import type { Page } from "./utils/app-test";
import { expect, test } from "./utils/app-test";

import { cellSnapshotFixture } from "./utils/cell-fixture";
import { type AgentEventStreamEntry, mockAppApi } from "./utils/mock-api";
import { setTheme } from "./utils/theme";

const TARGET_CELL = cellSnapshotFixture[0];
const TARGET_CELL_ID = TARGET_CELL?.id ?? "snapshot-cell";
const SESSION_ID = `session-${TARGET_CELL_ID}`;

const TRACE_DIFF_TEXT = [
  "diff --git a/src/example.ts b/src/example.ts",
  "@@ -1 +1,2 @@",
  '+const message = "hello";',
  '-const message = "hi";',
].join("\n");

const TRACE_TOOL_TIME = { start: 1000, end: 2000 } as const;
const TRACE_MOBILE_VIEWPORT = { width: 375, height: 667 } as const;
const EXPAND_BUTTON_REGEX = /expand/i;
const TRACE_EXPAND_DELAY_MS = 50;

const TRACE_MESSAGES: AgentMessage[] = [
  {
    id: "msg-trace-user",
    sessionId: SESSION_ID,
    role: "user",
    content: "Can you clean up the greetings?",
    state: "completed",
    createdAt: "2025-01-01T00:00:00.000Z",
    parts: [
      {
        id: "part-trace-user",
        messageID: "msg-trace-user",
        sessionID: SESSION_ID,
        type: "text",
        text: "Can you clean up the greetings?",
      },
    ],
    parentId: null,
    errorMessage: null,
    errorName: null,
  },
  {
    id: "msg-trace-assistant",
    sessionId: SESSION_ID,
    role: "assistant",
    content: "Updated the file with formatted output.",
    state: "completed",
    createdAt: "2025-01-01T00:00:10.000Z",
    parentId: "msg-trace-user",
    errorMessage: null,
    errorName: null,
    parts: [
      {
        id: "part-trace-reasoning",
        messageID: "msg-trace-assistant",
        sessionID: SESSION_ID,
        type: "reasoning",
        text: "Review the file, apply formatting, confirm diff",
        time: {
          start: 1,
          end: 2,
        },
      },
      {
        id: "part-trace-tool",
        messageID: "msg-trace-assistant",
        sessionID: SESSION_ID,
        type: "tool",
        tool: "format_code",
        metadata: { diff: TRACE_DIFF_TEXT },
        state: {
          status: "completed",
          input: { filePath: "src/example.ts" },
          output: "Formatting applied",
          metadata: { diff: TRACE_DIFF_TEXT },
          time: { start: TRACE_TOOL_TIME.start, end: TRACE_TOOL_TIME.end },
        },
      },
      {
        id: "part-trace-patch",
        messageID: "msg-trace-assistant",
        sessionID: SESSION_ID,
        type: "patch",
        files: ["src/example.ts"],
        metadata: { diff: TRACE_DIFF_TEXT },
      },
    ],
  },
];

const TRACE_EVENTS: AgentEventStreamEntry[] = [
  { event: "history", data: { messages: TRACE_MESSAGES } },
  { event: "status", data: { status: "idle" } },
];

const SNAPSHOT_OPTIONS = {
  animations: "disabled" as const,
  fullPage: true,
};

async function navigateToAgentChat(
  page: Page,
  options?: {
    theme?: "light" | "dark";
    viewport?: { width: number; height: number };
  }
) {
  if (options?.viewport) {
    await page.setViewportSize(options.viewport);
  }
  const resolvedTheme = options?.theme ?? "light";
  await setTheme(page, resolvedTheme);
  if (resolvedTheme === "dark") {
    await page.emulateMedia({ colorScheme: "dark" });
  }

  await mockAppApi(page, {
    agentMessages: { [SESSION_ID]: TRACE_MESSAGES },
    agentEvents: TRACE_EVENTS,
  });

  await page.goto(`/cells/${TARGET_CELL_ID}/chat`);
  await expect(page.getByText("Reasoning")).toBeVisible();
}

async function expandAllTraceCards(page: Page) {
  const expandButtons = page.getByRole("button", { name: EXPAND_BUTTON_REGEX });
  while ((await expandButtons.count()) > 0) {
    await expandButtons
      .first()
      .evaluate((button) => (button as HTMLButtonElement).click());
    await page.waitForTimeout(TRACE_EXPAND_DELAY_MS);
  }
}

async function captureChatSnapshot(
  page: Page,
  config: {
    fileName: string;
    theme: "light" | "dark";
    viewport?: { width: number; height: number };
    expandTraces?: boolean;
  }
) {
  await navigateToAgentChat(page, {
    theme: config.theme,
    viewport: config.viewport,
  });

  if (config.expandTraces) {
    await expandAllTraceCards(page);
  }

  await expect(page).toHaveScreenshot(config.fileName, SNAPSHOT_OPTIONS);
}

test.describe("Agent Chat Traces", () => {
  test("captures trace stack in light mode", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-light.png",
      theme: "light",
    });
  });

  test("captures trace stack in dark mode", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-dark.png",
      theme: "dark",
    });
  });

  test("captures trace stack in mobile layout", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-mobile.png",
      theme: "light",
      viewport: TRACE_MOBILE_VIEWPORT,
    });
  });

  test("captures expanded trace stack in light mode", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-expanded-light.png",
      theme: "light",
      expandTraces: true,
    });
  });

  test("captures expanded trace stack in dark mode", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-expanded-dark.png",
      theme: "dark",
      expandTraces: true,
    });
  });

  test("captures expanded trace stack in mobile layout", async ({ page }) => {
    await captureChatSnapshot(page, {
      fileName: "agent-chat-expanded-mobile.png",
      theme: "light",
      viewport: TRACE_MOBILE_VIEWPORT,
      expandTraces: true,
    });
  });
});
