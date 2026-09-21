import type { OpenCodeClient } from "@opencode-ai/client";
import { describe, expect, it, vi } from "vitest";
import {
  assertProviderConnected,
  fetchProviderAuthCatalog,
} from "./provider-auth";

const location = {
  directory: "/tmp/provider-auth",
  project: {
    id: "provider-auth-project",
    directory: "/tmp/provider-auth",
    canonical: "/tmp/provider-auth",
  },
};

function createClient(options?: { connected?: boolean }) {
  const providerList = vi.fn(async () => ({
    location,
    data: [
      {
        id: "openai",
        integrationID: "openai-auth",
        name: "OpenAI",
        activation: "enabled" as const,
        package: "@ai-sdk/openai",
        settings: { apiKey: "must-not-leak" },
      },
      {
        id: "local",
        name: "Local",
        activation: "enabled" as const,
        package: "@ai-sdk/openai-compatible",
      },
    ],
  }));
  const integrationList = vi.fn(async () => ({
    location,
    data: [
      {
        id: "openai-auth",
        name: "OpenAI",
        metadata: { secret: "must-not-leak" },
        methods: [
          { type: "key" as const, label: "API key" },
          {
            id: "browser",
            type: "oauth" as const,
            label: "Sign in",
            form: [
              {
                key: "organization",
                type: "string" as const,
                title: "Organization",
                required: true,
                default: "hive",
                minLength: 2,
                maxLength: 64,
                custom: true,
                options: [{ value: "hive", label: "Hive" }],
                when: [{ key: "region", op: "eq" as const, value: "us" }],
              },
            ],
          },
          { type: "env" as const, names: ["OPENAI_API_KEY"] },
        ],
        connections: options?.connected
          ? [
              {
                type: "credential" as const,
                id: "credential-secret-id",
                label: "Work key",
              },
            ]
          : [],
      },
    ],
  }));
  return {
    client: {
      provider: { list: providerList },
      integration: { list: integrationList },
    } as unknown as OpenCodeClient,
    integrationList,
    providerList,
  };
}

describe("provider authentication", () => {
  it("projects connection state without exposing provider settings or integration metadata", async () => {
    const { client } = createClient({ connected: true });

    const catalog = await fetchProviderAuthCatalog(location.directory, client);

    expect(catalog.providers).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        integrationId: "openai-auth",
        state: "connected",
      },
      {
        id: "local",
        name: "Local",
        integrationId: null,
        state: "not_required",
      },
    ]);
    expect(catalog.integrations[0]).toMatchObject({
      id: "openai-auth",
      connected: true,
      connectionLabels: ["Work key"],
      methods: [
        { type: "key", label: "API key" },
        {
          type: "oauth",
          id: "browser",
          fields: [
            {
              key: "organization",
              type: "string",
              required: true,
              default: "hive",
              minLength: 2,
              maxLength: 64,
              custom: true,
              options: [{ value: "hive", label: "Hive" }],
              when: [{ key: "region", op: "eq", value: "us" }],
            },
          ],
        },
        {
          type: "env",
          environmentVariables: ["OPENAI_API_KEY"],
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain("must-not-leak");
    expect(JSON.stringify(catalog)).not.toContain("credential-secret-id");
  });

  it("rejects a provider with authentication methods and no connection", async () => {
    const { client } = createClient();

    await expect(
      assertProviderConnected({
        providerId: "openai",
        workspacePath: location.directory,
        client,
      })
    ).rejects.toThrow(
      'Provider "OpenAI" is not connected. Connect it in Hive Settings before starting an agent session.'
    );
  });

  it("allows providers that do not expose an authentication integration", async () => {
    const { client } = createClient();

    await expect(
      assertProviderConnected({
        providerId: "local",
        workspacePath: location.directory,
        client,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects command-only providers without a connection", async () => {
    const provider = {
      id: "aws",
      integrationID: "aws-auth",
      name: "AWS",
      activation: "enabled" as const,
      package: "@ai-sdk/amazon-bedrock",
    };
    const client = {
      provider: {
        list: vi.fn(async () => ({ location, data: [provider] })),
      },
      integration: {
        list: vi.fn(async () => ({
          location,
          data: [
            {
              id: "aws-auth",
              name: "AWS",
              methods: [
                {
                  id: "aws-login",
                  type: "command" as const,
                  label: "AWS login",
                  command: ["aws", "sso", "login"],
                },
              ],
              connections: [],
            },
          ],
        })),
      },
    } as unknown as OpenCodeClient;

    const catalog = await fetchProviderAuthCatalog(location.directory, client);
    expect(catalog.integrations[0]?.methods).toEqual([
      {
        id: "aws-login",
        type: "command",
        label: "AWS login",
        fields: [],
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain("aws sso login");

    await expect(
      assertProviderConnected({
        providerId: "aws",
        provider,
        workspacePath: location.directory,
        client,
      })
    ).rejects.toThrow('Provider "AWS" is not connected');
  });

  it("rejects providers whose declared integration is unavailable", async () => {
    const { client } = createClient();

    await expect(
      assertProviderConnected({
        providerId: "missing",
        provider: {
          id: "missing",
          integrationID: "missing-auth",
          name: "Missing provider",
          activation: "enabled",
          package: "@ai-sdk/openai-compatible",
        },
        workspacePath: location.directory,
        client,
      })
    ).rejects.toThrow('Provider "Missing provider" is not connected');
  });
});
