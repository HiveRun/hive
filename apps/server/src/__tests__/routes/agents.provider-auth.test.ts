import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  assertProviderConnected: vi.fn(),
  cancelProviderCommand: vi.fn(),
  cancelProviderOAuth: vi.fn(),
  completeProviderOAuth: vi.fn(),
  connectProviderKey: vi.fn(),
  fetchProviderAuthCatalog: vi.fn(),
  fetchProviderCommandStatus: vi.fn(),
  fetchProviderOAuthStatus: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  startProviderCommand: vi.fn(),
  startProviderOAuth: vi.fn(),
};

vi.mock("../../agents/provider-auth", () => ({
  assertProviderConnected: mocks.assertProviderConnected,
  cancelProviderCommand: mocks.cancelProviderCommand,
  cancelProviderOAuth: mocks.cancelProviderOAuth,
  completeProviderOAuth: mocks.completeProviderOAuth,
  connectProviderKey: mocks.connectProviderKey,
  fetchProviderAuthCatalog: mocks.fetchProviderAuthCatalog,
  fetchProviderCommandStatus: mocks.fetchProviderCommandStatus,
  fetchProviderOAuthStatus: mocks.fetchProviderOAuthStatus,
  startProviderCommand: mocks.startProviderCommand,
  startProviderOAuth: mocks.startProviderOAuth,
}));

vi.mock("../../workspaces/context", () => ({
  resolveWorkspaceContext: mocks.resolveWorkspaceContext,
}));

import { agentsRoutes } from "../../routes/agents";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const workspaceId = "workspace-provider-auth";
const workspacePath = "/tmp/workspace-provider-auth";

function providerAttemptRequest(
  integrationId: string,
  method: "oauth" | "command",
  methodId: string
) {
  return new Request(
    `http://localhost/api/agents/integrations/${integrationId}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, methodId }),
    }
  );
}

function providerKeyRequest(
  key: string,
  answer?: Record<string, string | number | boolean | string[]>
) {
  return new Request("http://localhost/api/agents/integrations/openai/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, key, answer }),
  });
}

describe("agent provider authentication routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspace: { path: workspacePath },
    });
    mocks.fetchProviderAuthCatalog.mockResolvedValue({
      integrations: [
        {
          id: "openai",
          name: "OpenAI",
          connected: false,
          connectionLabels: [],
          methods: [{ type: "key", label: "API key", fields: [] }],
        },
      ],
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          integrationId: "openai",
          state: "missing",
        },
      ],
    });
    mocks.connectProviderKey.mockResolvedValue(undefined);
    mocks.startProviderOAuth.mockResolvedValue({
      location: { directory: workspacePath },
      data: {
        attemptID: "oauth-attempt",
        url: "https://provider.example/authorize",
        instructions: "Authorize the provider",
        mode: "code",
        time: { created: 1, expires: 2000 },
      },
    });
    mocks.startProviderCommand.mockResolvedValue({
      location: { directory: workspacePath },
      data: {
        attemptID: "command-attempt",
        time: { created: 1, expires: 3000 },
      },
    });
  });

  it("returns only the sanitized integration catalog", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      new Request(
        `http://localhost/api/agents/integrations?workspaceId=${workspaceId}`
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(HTTP_OK);
    expect(payload).toEqual(
      await mocks.fetchProviderAuthCatalog.mock.results[0]?.value
    );
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(mocks.fetchProviderAuthCatalog).toHaveBeenCalledWith(workspacePath);
  });

  it("passes an API key to OpenCode without echoing it in the response", async () => {
    const app = new Elysia().use(agentsRoutes);
    const key = "sk-sensitive-value";

    const response = await app.handle(providerKeyRequest(key));
    const payload = await response.json();

    expect(response.status).toBe(HTTP_OK);
    expect(payload).toEqual({ ok: true });
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(mocks.connectProviderKey).toHaveBeenCalledWith({
      workspacePath,
      integrationId: "openai",
      key,
      answer: undefined,
    });
  });

  it("surfaces structured OpenCode errors without echoing submitted secrets", async () => {
    const app = new Elysia().use(agentsRoutes);
    const key = "sk-sensitive-value";
    mocks.connectProviderKey.mockRejectedValueOnce({
      _tag: "InvalidRequestError",
      message: `Credential ${key} with PIN 123456 is invalid`,
    });

    const response = await app.handle(
      providerKeyRequest(key, { pin: 123_456 })
    );
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = await response.json();
    expect(payload).toEqual({
      message: "Credential [REDACTED] with PIN [REDACTED] is invalid",
    });
    expect(JSON.stringify(payload)).not.toContain(key);
  });

  it("maps OpenCode's wrapped OAuth attempt response", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      providerAttemptRequest("github", "oauth", "browser")
    );

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      attemptId: "oauth-attempt",
      url: "https://provider.example/authorize",
      instructions: "Authorize the provider",
      mode: "code",
      expiresAt: 2000,
    });
  });

  it("maps OpenCode's wrapped command attempt response", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      providerAttemptRequest("aws", "command", "aws-login")
    );

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      attemptId: "command-attempt",
      expiresAt: 3000,
    });
  });
});
