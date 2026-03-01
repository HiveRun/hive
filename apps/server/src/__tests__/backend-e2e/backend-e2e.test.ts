import { createOpencodeClient } from "@opencode-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BackendE2eRuntime,
  startBackendE2eServer,
  stopBackendE2eServer,
} from "./harness/runtime";
import {
  createCell,
  createWorkspace,
  deleteCell,
  fetchSessionMessages,
  listActivity,
  listCells,
  listServices,
  listWorkspaces,
  postCellAction,
  type ServiceRecord,
  waitForAssistantMessage,
  waitForCellStatus,
  waitForSessionByCell,
} from "./utils/http";
import { connectSse } from "./utils/sse";

const KEEP_ARTIFACTS = process.env.HIVE_BACKEND_E2E_KEEP_ARTIFACTS === "1";
const SSE_WAIT_TIMEOUT_MS = 120_000;
const BOOTSTRAP_TIMEOUT_MS = 240_000;
const TEARDOWN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 240_000;
const SDK_SMOKE_TIMEOUT_MS = 300_000;
const ASSISTANT_WAIT_TIMEOUT_MS = 120_000;
const OPENCODE_ATTACH_URL_RE = /opencode\s+attach\s+"([^"]+)"/;

type ManagedServer = Awaited<ReturnType<typeof startBackendE2eServer>>;

describe("backend e2e suite", () => {
  let server: ManagedServer;
  let runtime: BackendE2eRuntime;
  let workspaceId: string;

  beforeAll(async () => {
    server = await startBackendE2eServer();
    runtime = server.runtime;

    const workspaces = await listWorkspaces(runtime.apiUrl);
    workspaceId =
      workspaces.activeWorkspaceId ?? workspaces.workspaces[0]?.id ?? "";

    if (!workspaceId) {
      throw new Error("No active workspace available for backend e2e tests");
    }
  }, BOOTSTRAP_TIMEOUT_MS);

  afterAll(async () => {
    await stopBackendE2eServer(server, KEEP_ARTIFACTS);
  }, TEARDOWN_TIMEOUT_MS);

  it(
    "emits default and override mode events from agent SSE",
    async () => {
      const defaultCell = await createCell(runtime.apiUrl, {
        name: `mode-default-${Date.now()}`,
        workspaceId,
        templateId: "e2e-template",
      });

      const overrideCell = await createCell(runtime.apiUrl, {
        name: `mode-build-${Date.now()}`,
        workspaceId,
        templateId: "e2e-template",
        startMode: "build",
      });

      try {
        await waitForCellStatus(runtime.apiUrl, defaultCell.id, "ready");
        await waitForCellStatus(runtime.apiUrl, overrideCell.id, "ready");

        const defaultSession = await waitForSessionByCell(
          runtime.apiUrl,
          defaultCell.id
        );
        const overrideSession = await waitForSessionByCell(
          runtime.apiUrl,
          overrideCell.id
        );

        const defaultSse = await connectSse(
          `${runtime.apiUrl}/api/agents/sessions/${defaultSession.id}/events`
        );
        const overrideSse = await connectSse(
          `${runtime.apiUrl}/api/agents/sessions/${overrideSession.id}/events`
        );

        try {
          await defaultSse.waitForEvent({
            event: "status",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });
          const defaultModeEvent = await defaultSse.waitForEvent({
            event: "mode",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });

          await overrideSse.waitForEvent({
            event: "status",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });
          const overrideModeEvent = await overrideSse.waitForEvent({
            event: "mode",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });

          expect(defaultModeEvent.data).toMatchObject({
            startMode: "plan",
            currentMode: "plan",
          });

          expect(overrideModeEvent.data).toMatchObject({
            startMode: "build",
            currentMode: "build",
          });
        } finally {
          await Promise.all([defaultSse.close(), overrideSse.close()]);
        }
      } finally {
        await Promise.all([
          deleteCell(runtime.apiUrl, defaultCell.id),
          deleteCell(runtime.apiUrl, overrideCell.id),
        ]);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    "streams service lifecycle updates for stop/start/restart",
    async () => {
      const cell = await createCell(runtime.apiUrl, {
        name: `services-${Date.now()}`,
        workspaceId,
        templateId: "e2e-services-template",
      });

      try {
        await waitForCellStatus(runtime.apiUrl, cell.id, "ready");
        const services = await listServices(runtime.apiUrl, cell.id);
        expect(services.length).toBeGreaterThanOrEqual(2);

        const targetService = services[0] as ServiceRecord;
        const stream = await connectSse(
          `${runtime.apiUrl}/api/cells/${cell.id}/services/stream`
        );

        try {
          await stream.waitForEvent({
            event: "ready",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });
          await stream.waitForEvent({
            event: "snapshot",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });

          await postCellAction(
            runtime.apiUrl,
            `/api/cells/${cell.id}/services/${targetService.id}/stop`
          );

          await stream.waitForEvent({
            event: "service",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
            predicate: (event) => {
              if (!isServicePayload(event.data)) {
                return false;
              }
              return event.data.id === targetService.id;
            },
          });

          const activityAfterStop = await listActivity(runtime.apiUrl, cell.id);
          expect(
            activityAfterStop.some((record) => record.type === "service.stop")
          ).toBe(true);

          await postCellAction(
            runtime.apiUrl,
            `/api/cells/${cell.id}/services/${targetService.id}/start`
          );

          await stream.waitForEvent({
            event: "service",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
            predicate: (event) => {
              if (!isServicePayload(event.data)) {
                return false;
              }
              return event.data.id === targetService.id;
            },
          });

          const activityAfterStart = await listActivity(
            runtime.apiUrl,
            cell.id
          );
          expect(
            activityAfterStart.some((record) => record.type === "service.start")
          ).toBe(true);

          await postCellAction(
            runtime.apiUrl,
            `/api/cells/${cell.id}/services/restart`
          );

          await stream.waitForEvent({
            event: "service",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
            predicate: (event) => {
              if (!isServicePayload(event.data)) {
                return false;
              }
              return event.data.id === targetService.id;
            },
          });

          const activity = await listActivity(runtime.apiUrl, cell.id);
          expect(
            activity.some((record) => record.type === "services.restart")
          ).toBe(true);
        } finally {
          await stream.close();
        }
      } finally {
        await deleteCell(runtime.apiUrl, cell.id);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    "runs a direct SDK prompt and observes server agent SSE lifecycle",
    async () => {
      const cell = await createCell(runtime.apiUrl, {
        name: `sdk-smoke-${Date.now()}`,
        workspaceId,
        templateId: "e2e-template",
      });

      try {
        const readyCell = await waitForCellStatus(
          runtime.apiUrl,
          cell.id,
          "ready"
        );
        const session = await waitForSessionByCell(
          runtime.apiUrl,
          readyCell.id
        );

        const stream = await connectSse(
          `${runtime.apiUrl}/api/agents/sessions/${session.id}/events`
        );

        try {
          await stream.waitForEvent({
            event: "status",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
          });

          const baseUrl = resolveOpencodeBaseUrl(readyCell.opencodeCommand);
          const client = createOpencodeClient({ baseUrl });
          const promptResponse = await client.session.prompt({
            path: { id: session.id },
            query: { directory: readyCell.workspacePath },
            body: {
              parts: [{ type: "text", text: "Reply with the word backend." }],
              agent: session.currentMode ?? session.startMode ?? "plan",
            },
          });

          if (promptResponse.error) {
            throw new Error(
              `OpenCode SDK prompt failed: ${JSON.stringify(promptResponse.error)}`
            );
          }

          await stream.waitForEvent({
            event: "status",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
            predicate: (event) => isStatusEvent(event.data, "working"),
          });

          await stream.waitForEvent({
            event: "status",
            timeoutMs: SSE_WAIT_TIMEOUT_MS,
            predicate: (event) => isStatusEvent(event.data, "awaiting_input"),
          });

          const assistantMessage = await waitForAssistantMessage(
            runtime.apiUrl,
            session.id,
            { timeoutMs: ASSISTANT_WAIT_TIMEOUT_MS }
          );
          expect(assistantMessage.role).toBe("assistant");

          const allMessages = await fetchSessionMessages(
            runtime.apiUrl,
            session.id
          );
          expect(
            allMessages.some((message) => message.role === "assistant")
          ).toBe(true);
        } finally {
          await stream.close();
        }
      } finally {
        await deleteCell(runtime.apiUrl, cell.id);
      }
    },
    SDK_SMOKE_TIMEOUT_MS
  );

  it(
    "isolates cells by workspace using API list",
    async () => {
      const workspace = await createWorkspace(runtime.apiUrl, {
        path: runtime.secondaryWorkspaceRoot,
        label: "Backend E2E Secondary",
      });

      const primaryCell = await createCell(runtime.apiUrl, {
        name: `primary-${Date.now()}`,
        workspaceId,
        templateId: "e2e-template",
      });

      const secondaryCell = await createCell(runtime.apiUrl, {
        name: `secondary-${Date.now()}`,
        workspaceId: workspace.id,
        templateId: "e2e-template",
      });

      try {
        await waitForCellStatus(runtime.apiUrl, primaryCell.id, "ready");
        await waitForCellStatus(runtime.apiUrl, secondaryCell.id, "ready");

        const primaryList = await listCells(runtime.apiUrl, workspaceId);
        const secondaryList = await listCells(runtime.apiUrl, workspace.id);

        const primaryIds = new Set(primaryList.map((record) => record.id));
        const secondaryIds = new Set(secondaryList.map((record) => record.id));

        expect(primaryIds.has(primaryCell.id)).toBe(true);
        expect(primaryIds.has(secondaryCell.id)).toBe(false);
        expect(secondaryIds.has(secondaryCell.id)).toBe(true);
        expect(secondaryIds.has(primaryCell.id)).toBe(false);
      } finally {
        await Promise.all([
          deleteCell(runtime.apiUrl, primaryCell.id),
          deleteCell(runtime.apiUrl, secondaryCell.id),
        ]);
      }
    },
    TEST_TIMEOUT_MS
  );
});

function resolveOpencodeBaseUrl(opencodeCommand: string | null): string {
  if (!opencodeCommand) {
    throw new Error("Cell opencodeCommand is missing");
  }

  const attachMatch = opencodeCommand.match(OPENCODE_ATTACH_URL_RE);
  if (!attachMatch?.[1]) {
    throw new Error(
      `Unable to parse OpenCode base URL from '${opencodeCommand}'`
    );
  }

  return attachMatch[1];
}

function isStatusEvent(
  payload: unknown,
  status: "working" | "awaiting_input"
): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return (payload as { status?: string }).status === status;
}

function isServicePayload(
  payload: unknown
): payload is { id: string; status: string } {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as { id?: unknown; status?: unknown };
  return (
    typeof candidate.id === "string" && typeof candidate.status === "string"
  );
}
