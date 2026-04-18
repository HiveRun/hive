import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
const useQueryMock = vi.fn();
const useInfiniteQueryMock = vi.fn();
const useMutationMock = vi.fn();
let statusResponse: Record<string, unknown>;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useInfiniteQuery: (...args: unknown[]) => useInfiniteQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useNavigate: () => navigateMock,
    useSearch: () => ({ workspaceId: "workspace-1" }),
    useLoaderData: () => ({ workspaceId: "workspace-1" }),
  }),
  useNavigate: () => navigateMock,
  Link: ({
    children,
    search,
    to,
  }: {
    children: React.ReactNode;
    search?: Record<string, string>;
    to: string;
  }) => {
    const params = search ? new URLSearchParams(search).toString() : "";
    return <a href={`${to}${params ? `?${params}` : ""}`}>{children}</a>;
  },
}));

vi.mock("@/components/cell-creation-sheet", () => ({
  CellCreationSheet: ({
    initialPrefill,
    open,
  }: {
    initialPrefill?: { sourceLabel?: string };
    open: boolean;
  }) =>
    open ? (
      <div data-testid="mock-cell-creation-sheet">
        <div>Create New Cell</div>
        {initialPrefill?.sourceLabel ? (
          <div>Source: Linear {initialPrefill.sourceLabel}</div>
        ) : null}
      </div>
    ) : null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-select">{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
}));

import { LinearRouteComponent } from "./linear";

describe("Linear route", () => {
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    const noop = () => null;
    globalThis.ResizeObserver = class ResizeObserver {
      disconnect = noop;
      observe = noop;
      unobserve = noop;
    } as typeof ResizeObserver;

    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= noop;
    Element.prototype.setPointerCapture ??= noop;

    navigateMock.mockReset();
    invalidateQueriesMock.mockClear();
    useQueryMock.mockReset();
    useInfiniteQueryMock.mockReset();
    useMutationMock.mockReset();

    statusResponse = {
      connected: true,
      user: {
        id: "user-1",
        name: "Linear User",
        email: "linear@example.com",
      },
      organization: {
        id: "org-1",
        name: "Linear Org",
      },
      team: {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
      },
    };

    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      const [scope, kind] = options.queryKey;

      if (scope === "workspaces") {
        return {
          data: {
            workspaces: [
              {
                id: "workspace-1",
                label: "Workspace One",
                path: "/tmp/workspace-one",
              },
            ],
          },
        };
      }

      if (scope === "linear" && kind === "status") {
        return {
          data: statusResponse,
          error: null,
          isPending: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (scope === "linear" && kind === "teams") {
        return {
          data: {
            teams: [
              {
                id: "team-1",
                key: "ENG",
                name: "Engineering",
              },
              {
                id: "team-2",
                key: "PLT",
                name: "Platform",
              },
            ],
          },
          error: null,
          isPending: false,
        };
      }

      return {
        data: null,
        error: null,
        isFetching: false,
        isPending: false,
        refetch: vi.fn(),
      };
    });

    useInfiniteQueryMock.mockReturnValue({
      data: {
        pages: [
          {
            issues: [
              {
                id: "issue-1",
                teamId: "team-1",
                identifier: "ENG-42",
                title: "Improve Linear integration",
                description:
                  "Searchable description for the Linear integration issue that is long enough to produce a collapsed preview in the list while still being visible in the expanded details panel for this ticket.",
                url: "https://linear.app/hiverun/issue/ENG-42",
                updatedAt: "2025-01-01T00:00:00.000Z",
                state: {
                  id: "state-1",
                  name: "Backlog",
                  color: null,
                },
                assignee: {
                  id: "assignee-1",
                  name: "Assignee Person",
                  email: "assignee@example.com",
                },
              },
              {
                id: "issue-2",
                teamId: "team-1",
                identifier: "ENG-7",
                title: "Short issue summary",
                description: "Short note.",
                url: "https://linear.app/hiverun/issue/ENG-7",
                updatedAt: "2025-01-02T00:00:00.000Z",
                state: {
                  id: "state-2",
                  name: "Todo",
                  color: null,
                },
                assignee: null,
              },
            ],
          },
        ],
      },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    });

    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("renders a create-cell link for each loaded issue", () => {
    render(<LinearRouteComponent />);

    expect(
      screen.getAllByText("Improve Linear integration").length
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: "Create Cell" })
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Create Cell" }).length
    ).toBeGreaterThan(0);
  });

  it("opens the shared cell creation sheet from a Linear issue", () => {
    render(<LinearRouteComponent />);

    const [createCellButton] = screen.getAllByRole("button", {
      name: "Create Cell",
    });
    if (!createCellButton) {
      throw new Error("Expected a Create Cell button to be rendered");
    }

    fireEvent.click(createCellButton);

    expect(screen.getByText("Create New Cell")).toBeInTheDocument();
  });

  it("filters loaded issues from title, description, or pasted links", () => {
    render(<LinearRouteComponent />);

    const [filterInput] = screen.getAllByPlaceholderText(
      "Filter loaded issues or paste a Linear issue link"
    );
    if (!filterInput) {
      throw new Error("Expected the issue filter input to be rendered");
    }

    fireEvent.change(filterInput, {
      target: { value: "Searchable description" },
    });

    expect(
      screen.getAllByText("Improve Linear integration").length
    ).toBeGreaterThan(0);

    fireEvent.change(filterInput, {
      target: { value: "https://linear.app/hiverun/issue/ENG-42" },
    });

    expect(
      screen.getAllByText("Improve Linear integration").length
    ).toBeGreaterThan(0);

    fireEvent.change(filterInput, {
      target: { value: "does-not-match" },
    });

    expect(
      screen.getByText(
        "No loaded issues match that filter. Try a title, identifier, description term, or paste a Linear issue link."
      )
    ).toBeInTheDocument();
  });

  it("expands a ticket to show the full description", () => {
    render(<LinearRouteComponent />);

    const [showDetailsButton] = screen.getAllByRole("button", {
      name: "Show Details",
    });
    if (!showDetailsButton) {
      throw new Error("Expected at least one Show Details button");
    }

    fireEvent.click(showDetailsButton);

    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Hide Details" }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Searchable description for the Linear integration issue that is long enough to produce a collapsed preview in the list while still being visible in the expanded details panel for this ticket."
      ).length
    ).toBeGreaterThan(0);
  });

  it("hides the expand toggle when the description is already short", () => {
    render(<LinearRouteComponent />);

    const [shortIssueTitle] = screen.getAllByText("Short issue summary");
    if (!shortIssueTitle) {
      throw new Error("Expected the short issue to be rendered");
    }

    const shortIssueRow = shortIssueTitle.closest(
      "[data-linear-issue-row='true']"
    );
    if (!shortIssueRow) {
      throw new Error("Expected to locate the short issue row");
    }

    expect(
      within(shortIssueRow as HTMLElement).queryByRole("button", {
        name: "Show Details",
      })
    ).not.toBeInTheDocument();
  });

  it("renders the personal token form when Linear is disconnected", () => {
    statusResponse = {
      connected: false,
      user: null,
      organization: null,
      team: null,
    };

    render(<LinearRouteComponent />);

    expect(screen.getByPlaceholderText("lin_api_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Token" })).toBeDisabled();
  });

  it("renders team selection without a save button", () => {
    render(<LinearRouteComponent />);

    expect(
      screen.queryByRole("button", { name: "Change Team" })
    ).not.toBeInTheDocument();

    expect(screen.getAllByText("Linked Team").length).toBeGreaterThan(0);
  });
});
