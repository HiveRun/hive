import type { OpenCodeClient } from "@opencode-ai/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelProviderCommand,
  cancelProviderOAuth,
  completeProviderOAuth,
  connectProviderKey,
  fetchProviderCommandStatus,
  fetchProviderOAuthStatus,
  startProviderCommand,
  startProviderOAuth,
} from "./provider-auth";

const workspacePath = "/tmp/provider-connect";
const location = { location: { directory: workspacePath } };

describe("provider authentication connections", () => {
  let client: OpenCodeClient;
  const connectKey = vi.fn();
  const connectOAuth = vi.fn();
  const oauthStatus = vi.fn();
  const completeOAuth = vi.fn();
  const cancelOAuth = vi.fn();
  const connectCommand = vi.fn();
  const commandStatus = vi.fn();
  const cancelCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      integration: {
        connect: { key: connectKey },
        oauth: {
          connect: connectOAuth,
          status: oauthStatus,
          complete: completeOAuth,
          cancel: cancelOAuth,
        },
        command: {
          connect: connectCommand,
          status: commandStatus,
          cancel: cancelCommand,
        },
      },
    } as unknown as OpenCodeClient;
  });

  it("stores API keys through OpenCode's integration API", async () => {
    connectKey.mockResolvedValue(undefined);

    await connectProviderKey({
      workspacePath,
      integrationId: "openai",
      key: "sk-secret",
      answer: { organization: "hive" },
      client,
    });

    expect(connectKey).toHaveBeenCalledWith({
      integrationID: "openai",
      ...location,
      key: "sk-secret",
      answer: { organization: "hive" },
    });
  });

  it("delegates the complete OAuth lifecycle to OpenCode", async () => {
    const attempt = {
      location,
      data: {
        url: "https://provider.example/authorize",
        mode: "code" as const,
        attemptID: "attempt-1",
        instructions: "Authorize Hive",
        time: { created: 1, expires: 2 },
      },
    };
    connectOAuth.mockResolvedValue(attempt);
    oauthStatus.mockResolvedValue({
      location,
      data: { status: "pending", time: { created: 1, expires: 2 } },
    });
    completeOAuth.mockResolvedValue(undefined);
    cancelOAuth.mockResolvedValue(undefined);

    await expect(
      startProviderOAuth({
        workspacePath,
        integrationId: "github",
        methodId: "browser",
        answer: { host: "github.com" },
        client,
      })
    ).resolves.toEqual(attempt);
    await expect(
      fetchProviderOAuthStatus({
        workspacePath,
        integrationId: "github",
        attemptId: "attempt-1",
        client,
      })
    ).resolves.toEqual({
      location,
      data: { status: "pending", time: { created: 1, expires: 2 } },
    });
    await completeProviderOAuth({
      workspacePath,
      integrationId: "github",
      attemptId: "attempt-1",
      code: "oauth-code",
      client,
    });
    await cancelProviderOAuth({
      workspacePath,
      integrationId: "github",
      attemptId: "attempt-1",
      client,
    });

    expect(connectOAuth).toHaveBeenCalledWith({
      integrationID: "github",
      methodID: "browser",
      ...location,
      answer: { host: "github.com" },
    });
    expect(oauthStatus).toHaveBeenCalledWith({
      integrationID: "github",
      attemptID: "attempt-1",
      ...location,
    });
    expect(completeOAuth).toHaveBeenCalledWith({
      integrationID: "github",
      attemptID: "attempt-1",
      ...location,
      code: "oauth-code",
    });
    expect(cancelOAuth).toHaveBeenCalledWith({
      integrationID: "github",
      attemptID: "attempt-1",
      ...location,
    });
  });

  it("delegates the command connection lifecycle to OpenCode", async () => {
    const attempt = {
      location,
      data: {
        attemptID: "command-attempt-1",
        time: { created: 1, expires: 2 },
      },
    };
    const status = {
      location,
      data: {
        status: "pending" as const,
        message: "Waiting for login",
        time: { created: 1, expires: 2 },
      },
    };
    connectCommand.mockResolvedValue(attempt);
    commandStatus.mockResolvedValue(status);
    cancelCommand.mockResolvedValue(undefined);

    await expect(
      startProviderCommand({
        workspacePath,
        integrationId: "aws",
        methodId: "aws-login",
        client,
      })
    ).resolves.toEqual(attempt);
    await expect(
      fetchProviderCommandStatus({
        workspacePath,
        integrationId: "aws",
        attemptId: "command-attempt-1",
        client,
      })
    ).resolves.toEqual(status);
    await cancelProviderCommand({
      workspacePath,
      integrationId: "aws",
      attemptId: "command-attempt-1",
      client,
    });

    expect(connectCommand).toHaveBeenCalledWith({
      integrationID: "aws",
      methodID: "aws-login",
      ...location,
    });
    expect(commandStatus).toHaveBeenCalledWith({
      integrationID: "aws",
      attemptID: "command-attempt-1",
      ...location,
    });
    expect(cancelCommand).toHaveBeenCalledWith({
      integrationID: "aws",
      attemptID: "command-attempt-1",
      ...location,
    });
  });
});
