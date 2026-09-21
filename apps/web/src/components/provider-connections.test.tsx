import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authCatalog: vi.fn(),
  connectKey: vi.fn(),
  oauthStatus: vi.fn(),
  startOAuth: vi.fn(),
}));

vi.mock("@/queries/provider-auth", () => ({
  providerAuthQueries: {
    byWorkspace: (workspaceId: string) => ({
      queryKey: ["provider-auth", workspaceId],
      queryFn: mocks.authCatalog,
    }),
    oauthStatus: (
      workspaceId: string,
      integrationId: string,
      attemptId: string
    ) => ({
      queryKey: [
        "provider-auth",
        workspaceId,
        integrationId,
        "oauth",
        attemptId,
      ],
      queryFn: mocks.oauthStatus,
    }),
    commandStatus: () => ({
      queryKey: ["provider-auth", "command", "pending"],
      queryFn: async () => ({ status: "pending" }),
    }),
  },
  providerAuthMutations: {
    connectKey: { mutationFn: mocks.connectKey },
    startOAuth: { mutationFn: mocks.startOAuth },
    completeOAuth: { mutationFn: vi.fn() },
    cancelOAuth: { mutationFn: vi.fn() },
    startCommand: { mutationFn: vi.fn() },
    cancelCommand: { mutationFn: vi.fn() },
  },
}));

import { ProviderConnections } from "./provider-connections";

const PROVIDER_HEADING_PATTERN = /^(OpenAI|OpenCode)$/;

describe("ProviderConnections", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.authCatalog.mockReset();
    mocks.connectKey.mockReset();
    mocks.oauthStatus.mockReset();
    mocks.startOAuth.mockReset();
    mocks.authCatalog.mockResolvedValue(keyCatalog());
    mocks.connectKey.mockResolvedValue(undefined);
    mocks.oauthStatus.mockResolvedValue({ status: "pending" });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("submits visible defaults without retaining the API key in mutation state", async () => {
    render(
      <ProviderConnections providerId="openai" workspaceId="workspace-1" />,
      { wrapper: TestQueryProvider }
    );

    expect(await screen.findByLabelText("Endpoint")).toHaveValue(
      "https://api.example.com"
    );
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Custom region"));
    fireEvent.change(await screen.findByLabelText("Organization"), {
      target: { value: "hidden-organization" },
    });
    fireEvent.click(screen.getByLabelText("Custom region"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument()
    );

    const key = "sk-sensitive-value";
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: key },
    });
    await submitProviderConnection();
    expect(mocks.connectKey).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "openai-auth",
      key,
      answer: {
        region: false,
        endpoint: "https://api.example.com",
      },
    });
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.variables === undefined)
    ).toBe(true);
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll())
    ).not.toContain(key);
  });

  it("unlocks authentication controls after an OAuth attempt fails", async () => {
    mocks.authCatalog.mockResolvedValue(oauthCatalog());
    mocks.startOAuth.mockResolvedValue({
      attemptId: "oauth-attempt",
      url: "https://provider.example/authorize",
      instructions: "Authorize the provider",
      mode: "auto",
      expiresAt: null,
    });
    mocks.oauthStatus.mockResolvedValue({
      status: "failed",
      message: "Authorization denied",
    });

    render(
      <ProviderConnections providerId="github" workspaceId="workspace-1" />,
      { wrapper: TestQueryProvider }
    );

    const signInButton = await screen.findByRole("button", { name: "Sign in" });
    fireEvent.click(signInButton);

    await waitFor(() => expect(mocks.startOAuth).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signInButton).not.toBeDisabled());
    await waitFor(() =>
      expect(
        screen.queryByText("Authorize the provider")
      ).not.toBeInTheDocument()
    );
  });

  it("allows an existing connection to be replaced", async () => {
    const catalog = keyCatalog();
    const integration = catalog.integrations[0];
    if (!integration) {
      throw new Error("Expected provider integration fixture");
    }
    mocks.authCatalog.mockResolvedValue({
      ...catalog,
      integrations: [
        {
          ...integration,
          connected: true,
          connectionLabels: ["default", "OPENAI_API_KEY"],
        },
      ],
    });

    render(
      <ProviderConnections providerId="openai" workspaceId="workspace-1" />,
      { wrapper: TestQueryProvider }
    );

    expect(await screen.findByText("default, OPENAI_API_KEY")).toBeVisible();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(await screen.findByLabelText("API key")).toBeVisible();
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "temporary-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(await screen.findByLabelText("API key")).toHaveValue("");
  });

  it("lists disconnected integrations after connected providers", async () => {
    mocks.authCatalog.mockResolvedValue({
      providers: [
        missingProvider("opencode", "OpenCode Zen", "opencode-auth"),
        { id: "openai", name: "OpenAI", state: "connected" },
      ],
      integrations: [
        keyIntegration("opencode-auth", "OpenCode", []),
        {
          ...keyIntegration("openai-auth", "OpenAI", []),
          connected: true,
          connectionLabels: ["default"],
        },
      ],
    });

    render(<ProviderConnections workspaceId="workspace-1" />, {
      wrapper: TestQueryProvider,
    });

    const headings = await screen.findAllByText(PROVIDER_HEADING_PATTERN);
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "OpenAI",
      "OpenCode",
    ]);
  });

  it("allows OpenCode fallback when the selected provider is absent", async () => {
    mocks.authCatalog.mockResolvedValue({ integrations: [], providers: [] });
    const onReadyChange = vi.fn();

    render(
      <ProviderConnections
        onReadyChange={onReadyChange}
        providerId="opencode-default"
        workspaceId="workspace-1"
      />,
      { wrapper: TestQueryProvider }
    );

    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true));
  });

  it("resets credential state when the workspace changes", async () => {
    queryClient.setQueryData(["provider-auth", "workspace-2"], keyCatalog());
    const { rerender } = render(
      <ProviderConnections providerId="openai" workspaceId="workspace-1" />,
      { wrapper: TestQueryProvider }
    );

    const keyInput = await screen.findByLabelText("API key");
    fireEvent.change(keyInput, { target: { value: "workspace-one-key" } });
    expect(keyInput).toHaveValue("workspace-one-key");

    rerender(
      <ProviderConnections providerId="openai" workspaceId="workspace-2" />
    );

    await waitFor(() =>
      expect(screen.getByLabelText("API key")).toHaveValue("")
    );
  });

  it("validates formats and integer fields while preserving literal field keys", async () => {
    mocks.authCatalog.mockResolvedValue(constrainedKeyCatalog());
    render(
      <ProviderConnections providerId="custom" workspaceId="workspace-1" />,
      { wrapper: TestQueryProvider }
    );

    const emailInput = await screen.findByLabelText("Account email");
    const seatsInput = screen.getByLabelText("Seat count");
    const activationInput = screen.getByLabelText("Activation time");
    const connectButton = screen.getByRole("button", { name: "Connect key" });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "secret" },
    });
    fireEvent.change(emailInput, { target: { value: "invalid" } });
    fireEvent.change(seatsInput, { target: { value: "1.5" } });
    fireEvent.change(activationInput, {
      target: { value: "2023-02-29T12:00" },
    });
    expect(connectButton).toBeDisabled();

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(seatsInput, { target: { value: "2" } });
    fireEvent.change(activationInput, {
      target: { value: "2024-02-29T12:00" },
    });
    await submitProviderConnection();
    expect(mocks.connectKey).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "custom-auth",
      key: "secret",
      answer: {
        "account.email": "user@example.com",
        "activation.time": "2024-02-29T12:00",
        "team.seats": 2,
      },
    });
  });

  function TestQueryProvider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
});

async function submitProviderConnection() {
  const connectButton = screen.getByRole("button", { name: "Connect key" });
  await waitFor(() => expect(connectButton).not.toBeDisabled());
  fireEvent.click(connectButton);
  await waitFor(() => expect(mocks.connectKey).toHaveBeenCalledTimes(1));
}

function missingProvider(id: string, name: string, integrationId: string) {
  return { id, name, integrationId, state: "missing" };
}

function keyIntegration(id: string, name: string, fields: unknown[]) {
  return {
    id,
    name,
    connected: false,
    connectionLabels: [],
    methods: [{ type: "key", label: "API key", fields }],
  };
}

function keyCatalog() {
  return {
    integrations: [
      keyIntegration("openai-auth", "OpenAI", [
        {
          key: "region",
          type: "boolean",
          title: "Custom region",
          default: false,
        },
        {
          key: "organization",
          type: "string",
          title: "Organization",
          required: true,
          when: [{ key: "region", op: "eq", value: true }],
        },
        {
          key: "endpoint",
          type: "string",
          title: "Endpoint",
          default: "https://api.example.com",
        },
      ]),
    ],
    providers: [missingProvider("openai", "OpenAI", "openai-auth")],
  };
}

function oauthCatalog() {
  return {
    integrations: [
      {
        id: "github-auth",
        name: "GitHub",
        connected: false,
        connectionLabels: [],
        methods: [
          {
            id: "browser",
            type: "oauth",
            label: "Sign in",
            fields: [],
          },
        ],
      },
    ],
    providers: [missingProvider("github", "GitHub", "github-auth")],
  };
}

function constrainedKeyCatalog() {
  return {
    integrations: [
      keyIntegration("custom-auth", "Custom", [
        {
          key: "account.email",
          type: "string",
          title: "Account email",
          format: "email",
          required: true,
        },
        {
          key: "team.seats",
          type: "integer",
          title: "Seat count",
          required: true,
        },
        {
          key: "activation.time",
          type: "string",
          title: "Activation time",
          format: "date-time",
          required: true,
        },
      ]),
    ],
    providers: [missingProvider("custom", "Custom", "custom-auth")],
  };
}
