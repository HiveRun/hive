import { $, browser } from "@wdio/globals";
import { selectors } from "../src/selectors";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void>) => void;

type AgentSession = {
  id: string;
  status: string;
  updatedAt: string;
};

type AgentSessionResponse = {
  session: AgentSession | null;
};

const CHAT_ROUTE_TIMEOUT_MS = 120_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_ID_PATTERN = /\/cells\/([^/]+)\/chat/;

describe("cell chat flow", () => {
  it("creates a cell and sends a chat message", async () => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await browser.url("/");

    const createCellButton = await $(selectors.workspaceCreateCellButton);
    await createCellButton.waitForClickable({ timeout: CHAT_ROUTE_TIMEOUT_MS });
    await createCellButton.click();

    const cellNameInput = await $(selectors.cellNameInput);
    await cellNameInput.waitForDisplayed({ timeout: CHAT_ROUTE_TIMEOUT_MS });

    const testCellName = `E2E Cell ${Date.now()}`;
    await cellNameInput.setValue(testCellName);

    const submitButton = await $(selectors.cellSubmitButton);
    await submitButton.click();

    await browser.waitUntil(
      async () => {
        const url = await browser.getUrl();
        return CELL_CHAT_URL_PATTERN.test(url);
      },
      {
        timeout: CHAT_ROUTE_TIMEOUT_MS,
        timeoutMsg: "Expected to navigate to cell chat route after creation",
      }
    );

    const chatUrl = await browser.getUrl();
    const cellId = parseCellIdFromUrl(chatUrl);

    const terminalConnectionBadge = await $(selectors.terminalConnectionBadge);
    await browser.waitUntil(
      async () => {
        const state = await terminalConnectionBadge.getAttribute(
          "data-connection-state"
        );
        return state === "online";
      },
      {
        timeout: TERMINAL_READY_TIMEOUT_MS,
        timeoutMsg: "Terminal connection never reached online state",
      }
    );

    const sessionBeforeSend = await waitForAgentSession(apiUrl, cellId);

    const terminalInputSurface = await $(selectors.terminalInputSurface);
    await terminalInputSurface.click();

    const prompt = `E2E token ${Date.now()}`;
    await browser.keys(prompt);
    await browser.keys("Enter");

    await browser.waitUntil(
      async () => {
        const currentSession = await fetchAgentSession(apiUrl, cellId);
        if (!currentSession) {
          return false;
        }

        return (
          currentSession.updatedAt !== sessionBeforeSend.updatedAt ||
          currentSession.status !== sessionBeforeSend.status
        );
      },
      {
        timeout: SESSION_UPDATE_TIMEOUT_MS,
        timeoutMsg: "Agent session did not update after sending chat input",
      }
    );
  });
});

function parseCellIdFromUrl(url: string): string {
  const match = url.match(CELL_ID_PATTERN);
  if (!match?.[1]) {
    throw new Error(`Failed to parse cell ID from URL: ${url}`);
  }
  return match[1];
}

async function waitForAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession> {
  await browser.waitUntil(
    async () => {
      const session = await fetchAgentSession(apiUrl, cellId);
      return Boolean(session);
    },
    {
      timeout: SESSION_UPDATE_TIMEOUT_MS,
      timeoutMsg: "Agent session was not available for the created cell",
    }
  );

  const session = await fetchAgentSession(apiUrl, cellId);
  if (!session) {
    throw new Error("Agent session missing after successful wait");
  }

  return session;
}

async function fetchAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession | null> {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/byCell/${cellId}`
  );
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AgentSessionResponse;
  return payload.session;
}
