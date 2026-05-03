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
let currentRouteId = "/cells/$cellId/chat";

type MockCell = {
  id: string;
  name: string;
  description: string;
  status: "ready" | "spawning" | "pending" | "error";
  workspaceId: string | null;
};

let currentCell: MockCell;

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

describe("Cell detail route", () => {
  beforeEach(() => {
    currentCell = buildCell();
    currentRouteId = "/cells/$cellId/chat";
    useQueryMock.mockReset();
    prefetchQueryMock.mockClear();

    installResizeObserverMock();
    installImmediateAnimationFrameMock();

    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const [scope, key, subKey] = options.queryKey;

      if (scope === "workspaces") {
        return workspaceListQueryResult();
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
    expect(description).toHaveClass("line-clamp-4");
    expect(description).toHaveClass("break-words");
    expect(description).toHaveClass("whitespace-pre-wrap");
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
