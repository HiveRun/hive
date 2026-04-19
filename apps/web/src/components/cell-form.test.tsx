import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CellForm } from "./cell-form";

const { createCellMutationMock } = vi.hoisted(() => ({
  createCellMutationMock: vi.fn(),
}));
const REMOVE_BUTTON_NAME_PATTERN = /remove/i;

vi.mock("@/components/model-selector", () => ({
  ModelSelector: ({ onLoadingChange, onModelChange }: any) => {
    const initializedRef = useRef(false);

    useEffect(() => {
      if (initializedRef.current) {
        return;
      }

      initializedRef.current = true;
      onLoadingChange(false);
      onModelChange(
        {
          id: "big-pickle",
          providerId: "opencode",
        },
        "user"
      );
    }, [onLoadingChange, onModelChange]);

    return <div data-testid="mock-model-selector" />;
  },
}));

vi.mock("@/queries/cells", () => ({
  cellMutations: {
    create: {
      mutationFn: createCellMutationMock,
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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    createCellMutationMock.mockReset();
    createCellMutationMock.mockResolvedValue({
      id: "cell-1",
      name: "Image Cell",
      workspaceId: "workspace-1",
      status: "spawning",
      lastSetupError: null,
    });
  });

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

  it("adds pasted and selected images, then removes them", async () => {
    render(
      <TestQueryProvider>
        <CellForm workspaceId="workspace-1" />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("cell-image-input")).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId("cell-image-input");
    const selectedFile = new File(["selected"], "selected.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, {
      target: { files: [selectedFile] },
    });

    await waitFor(() => {
      expect(screen.getByText("selected.png")).toBeInTheDocument();
    });

    const pastedFile = new File(["pasted"], "pasted.png", {
      type: "image/png",
    });
    fireEvent.paste(screen.getByTestId("cell-form"), {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => pastedFile,
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("pasted.png")).toBeInTheDocument();
    });

    const [removeButton] = screen.getAllByRole("button", {
      name: REMOVE_BUTTON_NAME_PATTERN,
    });
    if (!removeButton) {
      throw new Error("Remove button not found");
    }

    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.queryByText("selected.png")).not.toBeInTheDocument();
    });
  });

  it("clears attached images when the form is repurposed with a new prefill", async () => {
    const { rerender } = render(
      <TestQueryProvider>
        <CellForm
          initialPrefill={{
            name: "First issue",
            description: "First description",
          }}
          workspaceId="workspace-1"
        />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("cell-image-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("cell-image-input"), {
      target: {
        files: [new File(["hello"], "carryover.png", { type: "image/png" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("carryover.png")).toBeInTheDocument();
    });

    rerender(
      <TestQueryProvider>
        <CellForm
          initialPrefill={{
            name: "Second issue",
            description: "Second description",
          }}
          workspaceId="workspace-1"
        />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText("carryover.png")).not.toBeInTheDocument();
    });
  });

  it("submits selected images with the create payload", async () => {
    render(
      <TestQueryProvider>
        <CellForm workspaceId="workspace-1" />
      </TestQueryProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Image Cell" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Inspect this screenshot" },
    });

    fireEvent.click(
      within(screen.getByTestId("template-select")).getByRole("combobox")
    );
    fireEvent.click(await screen.findByRole("option", { name: "Template 1" }));

    const fileInput = screen.getByTestId("cell-image-input");
    const screenshot = new File(["hello"], "screenshot.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, {
      target: { files: [screenshot] },
    });

    await waitFor(() => {
      expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId("cell-submit-button")).not.toBeDisabled();
    });

    fireEvent.submit(screen.getByTestId("cell-form"));

    await waitFor(() => {
      expect(createCellMutationMock).toHaveBeenCalledTimes(1);
    });

    expect(createCellMutationMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        name: "Image Cell",
        description: "Inspect this screenshot",
        workspaceId: "workspace-1",
        initialPromptImages: [
          expect.objectContaining({
            filename: "screenshot.png",
            mimeType: "image/png",
            base64Data: "aGVsbG8=",
          }),
        ],
      })
    );
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
