import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CellForm } from "./cell-form";

vi.mock("@/components/model-selector", () => ({
  ModelSelector: () => <div data-testid="mock-model-selector" />,
}));

vi.mock("@/queries/cells", () => ({
  cellMutations: {
    create: {
      mutationFn: vi.fn(),
    },
  },
  cellQueries: {
    detail: (id: string) => ({ queryKey: ["cells", id] as const }),
    all: (workspaceId: string) => ({
      queryKey: ["cells", workspaceId] as const,
    }),
  },
}));

vi.mock("@/queries/templates", () => ({
  templateQueries: {
    all: () => ({
      queryKey: ["templates", "workspace-1"] as const,
      queryFn: async () => ({
        templates: [
          {
            id: "template-1",
            label: "Template 1",
            type: "manual",
            configJson: {
              agent: {
                model: {
                  id: "big-pickle",
                  providerId: "opencode",
                },
              },
            },
          },
        ],
        defaults: {
          templateId: "template-1",
          startMode: "plan",
        },
        agentDefaults: {
          modelId: "big-pickle",
          providerId: "opencode",
        },
      }),
    }),
  },
}));

describe("CellForm", () => {
  it("renders the Linear prefill and source badge", async () => {
    const { rerender } = render(
      <TestQueryProvider>
        <CellForm
          initialPrefill={{
            name: "Improve Linear integration",
            description:
              "Improve Linear integration\n\nUse the linked Linear issue to scope the work.",
            sourceLabel: "ENG-42",
          }}
          workspaceId="workspace-1"
        />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue(
        "Improve Linear integration"
      );
    });

    expect(screen.getByLabelText("Description")).toHaveValue(
      "Improve Linear integration\n\nUse the linked Linear issue to scope the work."
    );
    expect(screen.getByText("Source: Linear ENG-42")).toBeInTheDocument();

    rerender(
      <TestQueryProvider>
        <CellForm
          initialPrefill={{
            name: "Fix follow-up issue",
            description:
              "Fix follow-up issue\n\nCarry the second issue details into the form.",
            sourceLabel: "ENG-43",
          }}
          workspaceId="workspace-1"
        />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Fix follow-up issue");
    });

    expect(screen.getByLabelText("Description")).toHaveValue(
      "Fix follow-up issue\n\nCarry the second issue details into the form."
    );
    expect(screen.getByText("Source: Linear ENG-43")).toBeInTheDocument();
  });
});

function TestQueryProvider({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
