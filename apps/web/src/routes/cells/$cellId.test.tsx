import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installImmediateAnimationFrameMock,
  installResizeObserverMock,
  workspaceListQueryResult,
} from "../-shared/test-dom";

const useQueryMock = vi.fn();
const prefetchQueryMock = vi.fn().mockResolvedValue(undefined);
const CHAR_COUNT_LABEL_PATTERN = /chars/i;
const LONG_DESCRIPTION =
  "This is a long cell description that should stay compact in the header until the user asks to see more details from the full prompt text shown in this view.";
const LONG_CELL_NAME_TOKEN = LONG_DESCRIPTION.split(" ").join("");
const LONG_CELL_NAME = `Long description cell ${LONG_CELL_NAME_TOKEN}${LONG_CELL_NAME_TOKEN}`;
const DEFAULT_WORKSPACE_LABEL = "Workspace One";
const LONG_WORKSPACE_LABEL = `Workspace ${LONG_CELL_NAME_TOKEN}${LONG_CELL_NAME_TOKEN}`;
const COLLAPSED_DESCRIPTION_CLASSES = [
  "line-clamp-4",
  "break-words",
  "whitespace-pre-wrap",
];
let currentRouteId = "/cells/$cellId/chat";

type MockCell = {
  id: string;
  name: string;
  description: string;
  status: "ready" | "spawning" | "pending" | "error";
  workspaceId: string | null;
};

let currentCell: MockCell;
let currentWorkspaceLabel = DEFAULT_WORKSPACE_LABEL;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueryClient: () => {
    const client = { prefetchQuery: prefetchQueryMock };
    return client;
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => {
    const route = { ...config };
    return Object.assign(route, {
      useParams: () => ({ cellId: currentCell.id }),
    });
  },
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Outlet: () => <div data-testid="mock-outlet" />,
  redirect: vi.fn(),
  useRouterState: () => ({
    matches: [{ routeId: currentRouteId }],
  }),
}));

import { CellLayout } from "./$cellId";

const buildCell = (overrides: Partial<MockCell> = {}): MockCell => ({
  id: "cell-1",
  name: "Long description cell",
  description: "Base description",
  status: "ready",
  workspaceId: "workspace-1",
  ...overrides,
});

const buildWorkspaceQueryResult = () => {
  const result = workspaceListQueryResult();
  return {
    ...result,
    data: {
      ...result.data,
      workspaces: result.data.workspaces.map((workspace) =>
        workspace.id === "workspace-1"
          ? { ...workspace, label: currentWorkspaceLabel }
          : workspace
      ),
    },
  };
};

describe("Cell detail route", () => {
  beforeEach(() => {
    currentCell = buildCell();
    currentRouteId = "/cells/$cellId/chat";
    currentWorkspaceLabel = DEFAULT_WORKSPACE_LABEL;
    useQueryMock.mockReset();
    prefetchQueryMock.mockClear();

    installResizeObserverMock();
    installImmediateAnimationFrameMock();

    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const [scope, key, subKey] = options.queryKey;

      if (scope === "workspaces") {
        return buildWorkspaceQueryResult();
      }

      if (scope === "cells" && subKey === "timings") {
        return {
          data: null,
          error: null,
          isPending: false,
        };
      }

      if (scope === "cells" && key === currentCell.id) {
        return {
          data: currentCell,
          error: null,
          isPending: false,
        };
      }

      return {
        data: null,
        error: null,
        isPending: false,
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders long descriptions in a prompt panel with an expand control", async () => {
    const expandButton = await renderInfoRouteWithDescription(LONG_DESCRIPTION);
    const description = screen.getByText(currentCell.description);

    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText(CHAR_COUNT_LABEL_PATTERN)).toBeInTheDocument();
    expect(expandButton).toBeInTheDocument();
    expect(description).toHaveClass(...COLLAPSED_DESCRIPTION_CLASSES);
  });

  it("keeps long cell names from crowding navigation controls", async () => {
    currentRouteId = "/cells/$cellId/setup";
    currentWorkspaceLabel = LONG_WORKSPACE_LABEL;
    currentCell = buildCell({
      description: LONG_DESCRIPTION,
      name: LONG_CELL_NAME,
    });

    render(<CellLayout />);

    const title = await screen.findByRole("heading", {
      name: currentCell.name,
    });
    const titleColumn = title.parentElement;
    const titleRow = titleColumn?.parentElement;
    const description = screen.getByText(currentCell.description);
    const workspaceLabel = screen.getByText(currentWorkspaceLabel);
    const navGroup = screen
      .getByRole("button", { name: "Chat" })
      .closest("div");

    expect(title).toHaveClass("min-w-0");
    expect(title).toHaveClass("break-words");
    expect(title).toHaveClass("line-clamp-2");
    expect(titleColumn).toHaveClass("min-w-0");
    expect(titleColumn).toHaveClass("flex-1");
    expect(titleColumn).toHaveClass("basis-64");
    expect(titleRow).toHaveClass("min-w-0");
    expect(workspaceLabel).toHaveClass("truncate");
    expect(workspaceLabel.parentElement).toHaveClass("min-w-0");
    expect(workspaceLabel.parentElement).toHaveClass("max-w-full");
    expect(navGroup).toHaveClass("w-full");
    expect(navGroup).toHaveClass("max-w-full");
    expect(navGroup).toHaveClass("md:w-auto");
    expect(navGroup).toHaveClass("md:shrink-0");
    expect(screen.getByRole("button", { name: "Info" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Services" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(description).toHaveClass(...COLLAPSED_DESCRIPTION_CLASSES);
  });

  it("expands and reclamps the description when toggled", async () => {
    await renderInfoRouteWithDescription(LONG_DESCRIPTION);
    const description = screen.getByText(currentCell.description);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand prompt" })
    );

    expect(
      screen.getByRole("button", { name: "Collapse prompt" })
    ).toBeInTheDocument();
    expect(description).toHaveClass("whitespace-pre-wrap");
    expect(description).not.toHaveClass("line-clamp-4");
    expect(description.parentElement).toHaveClass("max-h-[min(50vh,32rem)]");
    expect(description.parentElement).toHaveClass("overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "Collapse prompt" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand prompt" })
      ).toBeInTheDocument();
    });
    expect(description).toHaveClass("line-clamp-4");
    expect(description.parentElement?.className).not.toContain(
      "max-h-[min(50vh,32rem)]"
    );
  });

  it("hides the prompt panel outside the Info route", async () => {
    currentCell = buildCell({
      description:
        "This is a long cell description that should not appear in chat because the header needs the space back.",
    });

    render(<CellLayout />);

    await waitFor(() => {
      expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Expand prompt" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(currentCell.description)
      ).not.toBeInTheDocument();
    });
  });

  it("hides the expand control for short descriptions on the Info route", async () => {
    currentRouteId = "/cells/$cellId/setup";
    currentCell = buildCell({ description: "Short note." });

    render(<CellLayout />);

    await waitFor(() => {
      expect(screen.getByText("Prompt")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Expand prompt" })
      ).not.toBeInTheDocument();
    });
  });

  it("shows the expand control for multi-line descriptions", async () => {
    currentRouteId = "/cells/$cellId/setup";
    currentCell = buildCell({
      description: "First line of the prompt.\nSecond line of the prompt.",
    });

    render(<CellLayout />);

    expect(
      await screen.findByRole("button", { name: "Expand prompt" })
    ).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
  });
});

async function renderInfoRouteWithDescription(description: string) {
  currentRouteId = "/cells/$cellId/setup";
  currentCell = buildCell({ description });
  render(<CellLayout />);
  return await screen.findByRole("button", { name: "Expand prompt" });
}
