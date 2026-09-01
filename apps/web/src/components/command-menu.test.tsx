import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPointerCaptureMocks as installPointerCapturePolyfill,
  installResizeObserverMock,
} from "../routes/-shared/test-dom";

const navigateMock = vi.fn();
const setThemeMock = vi.fn();
const useQueryMock = vi.fn();
const useQueriesMock = vi.fn();

let currentPathname = "/";
let currentRouteId = "/";
let currentCellId: string | undefined;
let currentSearch: { workspaceId?: string } = {};
let currentTheme: "dark" | "light" | "system" = "system";

const workspaces = [
  {
    id: "workspace-1",
    label: "Workspace One",
    path: "/tmp/workspace-one",
  },
  {
    id: "workspace-2",
    label: "Workspace Two",
    path: "/tmp/workspace-two",
  },
];

const cellsByWorkspace = new Map([
  [
    "workspace-1",
    [
      {
        id: "cell-1",
        name: "Command Cell",
        status: "ready",
        workspaceId: "workspace-1",
        branchName: "command-menu",
      },
    ],
  ],
  [
    "workspace-2",
    [
      {
        id: "cell-2",
        name: "Provisioning Cell",
        status: "pending",
        workspaceId: "workspace-2",
        branchName: null,
      },
    ],
  ],
]);

let queriedCellsByWorkspace = cellsByWorkspace;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueries: (...args: unknown[]) => useQueriesMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: (options?: {
    select?: (state: {
      location: { pathname: string; search: { workspaceId?: string } };
      matches: Array<{ params: { cellId?: string }; routeId: string }>;
    }) => unknown;
  }) => {
    const matches = currentCellId
      ? [
          { params: {}, routeId: "/" },
          { params: { cellId: currentCellId }, routeId: "/cells/$cellId" },
          { params: { cellId: currentCellId }, routeId: currentRouteId },
        ]
      : [{ params: {}, routeId: currentRouteId }];
    const state = {
      location: { pathname: currentPathname, search: currentSearch },
      matches,
    };
    return options?.select ? options.select(state) : state;
  },
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
    theme: currentTheme,
  }),
}));

import { CommandMenu } from "./command-menu";

const renderCommandMenu = () => {
  const callbacks = {
    onCreateCell: vi.fn(),
    onManageWorkspaces: vi.fn(),
    onRegisterWorkspace: vi.fn(),
  };

  render(<CommandMenu {...callbacks} />);

  return callbacks;
};

const openCommandMenu = () => {
  fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
  return screen.getByTestId("command-menu");
};

const moveSelectionToCommand = async (testId: string) => {
  const input = screen.getByPlaceholderText(
    "Search commands, cells, workspaces..."
  );
  for (let index = 0; index < 24; index += 1) {
    const command = screen.getByTestId(testId);
    if (command.getAttribute("aria-selected") === "true") {
      return command;
    }
    fireEvent.keyDown(input, { key: "ArrowDown" });
  }

  await waitFor(() => {
    expect(screen.getByTestId(testId)).toHaveAttribute("aria-selected", "true");
  });
  return screen.getByTestId(testId);
};

const pressCommandInputKey = (key: string) =>
  fireEvent.keyDown(
    screen.getByPlaceholderText("Search commands, cells, workspaces..."),
    { key }
  );

const clickLinearCommand = () =>
  fireEvent.click(screen.getByTestId("command-menu-item-nav-linear"));

const linearNavigationForWorkspace = (workspaceId: string) => ({
  to: "/linear",
  search: { workspaceId },
});

const cellNavigation = (args: {
  cellId: string;
  to: string;
  workspaceId: string;
}) => ({
  to: args.to,
  params: { cellId: args.cellId },
  search: { workspaceId: args.workspaceId },
});

describe("CommandMenu", () => {
  beforeEach(() => {
    installResizeObserverMock();
    installPointerCapturePolyfill();
    Element.prototype.scrollIntoView = vi.fn();
    currentPathname = "/";
    currentRouteId = "/";
    currentCellId = undefined;
    currentSearch = {};
    currentTheme = "system";
    queriedCellsByWorkspace = cellsByWorkspace;
    navigateMock.mockReset();
    setThemeMock.mockReset();
    useQueryMock.mockReset();
    useQueriesMock.mockReset();
    useQueryMock.mockReturnValue({
      data: {
        activeWorkspaceId: "workspace-1",
        workspaces,
      },
    });
    useQueriesMock.mockImplementation(({ queries }: { queries: unknown[] }) =>
      queries.map((query) => {
        const queryKey = (query as { queryKey: unknown[] }).queryKey;
        const workspaceId = queryKey[1] as string;
        return { data: queriedCellsByWorkspace.get(workspaceId) ?? [] };
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("opens with Ctrl+K and shows stable global commands", () => {
    renderCommandMenu();

    const menu = openCommandMenu();

    expect(menu).toBeInTheDocument();
    expect(screen.getByText("Go to Overview")).toBeInTheDocument();
    expect(screen.getByText("Go to Linear")).toBeInTheDocument();
    expect(screen.getByText("Go to Android Runtime Lab")).toBeInTheDocument();
    expect(screen.getByText("Create Cell")).toBeInTheDocument();
    expect(screen.getByText("Manage Workspaces")).toBeInTheDocument();
    expect(screen.getByText("Register Workspace")).toBeInTheDocument();
  });

  it("opens with Meta+K", () => {
    renderCommandMenu();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByTestId("command-menu")).toBeInTheDocument();
  });

  it("toggles closed with Ctrl+K while search is focused", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.keyDown(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { ctrlKey: true, key: "k" }
    );

    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("only enables cell list queries while open", () => {
    renderCommandMenu();

    expect(useQueriesMock).toHaveBeenLastCalledWith({
      queries: expect.arrayContaining([
        expect.objectContaining({ enabled: false }),
      ]),
    });

    openCommandMenu();

    expect(useQueriesMock).toHaveBeenLastCalledWith({
      queries: expect.arrayContaining([
        expect.objectContaining({ enabled: true }),
      ]),
    });
  });

  it("does not open from editable surfaces", () => {
    renderCommandMenu();
    const input = document.createElement("input");
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "plaintext-only");
    document.body.append(input, contentEditable);

    fireEvent.keyDown(input, { ctrlKey: true, key: "k" });
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();

    fireEvent.keyDown(contentEditable, { ctrlKey: true, key: "k" });
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();

    input.remove();
    contentEditable.remove();
  });

  it("captures Ctrl+K before terminal handlers receive it", async () => {
    renderCommandMenu();
    const terminal = document.createElement("div");
    const xterm = document.createElement("div");
    const helperTextarea = document.createElement("textarea");
    const terminalHandler = vi.fn();
    terminal.dataset.testid = "cell-terminal";
    terminal.addEventListener("keydown", terminalHandler);
    xterm.className = "xterm";
    helperTextarea.className = "xterm-helper-textarea";
    xterm.append(helperTextarea);
    terminal.append(xterm);
    document.body.append(terminal);

    fireEvent.keyDown(helperTextarea, { ctrlKey: true, key: "k" });

    await waitFor(() => {
      expect(screen.getByTestId("command-menu")).toBeInTheDocument();
    });
    expect(terminalHandler).not.toHaveBeenCalled();

    terminal.remove();
  });

  it("navigates and closes when selecting a route command", () => {
    renderCommandMenu();
    openCommandMenu();

    clickLinearCommand();

    expect(navigateMock).toHaveBeenCalledWith(
      linearNavigationForWorkspace("workspace-1")
    );
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("navigates to the Android Runtime Lab", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.click(
      screen.getByTestId("command-menu-item-nav-android-runtime")
    );

    expect(navigateMock).toHaveBeenCalledWith({ to: "/android-runtime" });
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("preserves workspace search context when navigating to Linear", () => {
    currentSearch = { workspaceId: "workspace-2" };
    renderCommandMenu();
    openCommandMenu();

    clickLinearCommand();

    expect(navigateMock).toHaveBeenCalledWith(
      linearNavigationForWorkspace("workspace-2")
    );
  });

  it("runs safe action callbacks and closes the menu", () => {
    const callbacks = renderCommandMenu();
    openCommandMenu();

    fireEvent.click(screen.getByTestId("command-menu-item-action-create-cell"));

    expect(callbacks.onCreateCell).toHaveBeenCalledWith("workspace-1");
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();

    openCommandMenu();
    fireEvent.click(
      screen.getByTestId("command-menu-item-action-register-workspace")
    );

    expect(callbacks.onRegisterWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });

  it("uses workspace search context for Create Cell", () => {
    currentSearch = { workspaceId: "workspace-2" };
    const callbacks = renderCommandMenu();
    openCommandMenu();

    fireEvent.click(screen.getByTestId("command-menu-item-action-create-cell"));

    expect(callbacks.onCreateCell).toHaveBeenCalledWith("workspace-2");
  });

  it("marks the active top-level route as current", () => {
    currentPathname = "/linear";
    currentRouteId = "/linear";
    renderCommandMenu();

    openCommandMenu();
    const linearCommand = screen.getByTestId("command-menu-item-nav-linear");

    expect(within(linearCommand).getByText("Current")).toBeInTheDocument();
  });

  it("prioritizes the active cell tab without hiding peer tabs", () => {
    currentPathname = "/cells/cell-1/terminal";
    currentRouteId = "/cells/$cellId/terminal";
    currentCellId = "cell-1";
    renderCommandMenu();

    openCommandMenu();
    const terminalCommand = screen.getByTestId(
      "command-menu-item-cell-tab-/cells/$cellId/terminal"
    );
    const chatCommand = screen.getByTestId(
      "command-menu-item-cell-tab-/cells/$cellId/chat"
    );
    const cellCommands = screen.getAllByTestId((_content, element) =>
      Boolean(
        element
          ?.getAttribute("data-testid")
          ?.startsWith("command-menu-item-cell-tab-")
      )
    );

    expect(within(terminalCommand).getByText("Current")).toBeInTheDocument();
    expect(chatCommand).toBeInTheDocument();
    expect(cellCommands[0]).toBe(terminalCommand);
  });

  it("sets the selected theme", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.click(screen.getByTestId("command-menu-item-theme-dark"));

    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("scrolls the selected command into view during arrow navigation", async () => {
    renderCommandMenu();
    openCommandMenu();
    const scrollIntoViewMock = Element.prototype.scrollIntoView;
    vi.mocked(scrollIntoViewMock).mockClear();

    fireEvent.keyDown(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { key: "ArrowDown" }
    );

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "nearest",
        inline: "nearest",
      });
    });
  });

  it("drills into cell actions with Space and returns with ArrowLeft", async () => {
    renderCommandMenu();
    openCommandMenu();
    await moveSelectionToCommand("command-menu-item-open-cell-cell-1");

    pressCommandInputKey(" ");

    expect(
      screen.getByText("Command Rail / Open Cell: Command Cell")
    ).toBeInTheDocument();
    expect(screen.getByText("Open Terminal")).toBeInTheDocument();
    expect(screen.queryByText("Go to Overview")).not.toBeInTheDocument();

    pressCommandInputKey("ArrowLeft");

    await waitFor(() => {
      expect(screen.getByText("Command Rail")).toBeInTheDocument();
    });
    expect(screen.getByText("Go to Overview")).toBeInTheDocument();
    expect(
      screen.getByTestId("command-menu-item-open-cell-cell-1")
    ).toHaveAttribute("aria-selected", "true");
  });

  it("drills into cell actions with ArrowRight", async () => {
    renderCommandMenu();
    openCommandMenu();
    await moveSelectionToCommand("command-menu-item-open-cell-cell-1");

    pressCommandInputKey("ArrowRight");

    expect(
      screen.getByText("Command Rail / Open Cell: Command Cell")
    ).toBeInTheDocument();
    expect(screen.getByText("Open Terminal")).toBeInTheDocument();
  });

  it("restores search and selection when returning from a searched drill-in", async () => {
    renderCommandMenu();
    openCommandMenu();
    const input = screen.getByPlaceholderText(
      "Search commands, cells, workspaces..."
    );

    fireEvent.input(input, { target: { value: "open command" } });
    const openCellCommand = screen.getByTestId(
      "command-menu-item-open-cell-cell-1"
    );
    expect(openCellCommand).toHaveAttribute("aria-selected", "true");

    pressCommandInputKey("ArrowRight");
    expect(
      screen.getByText("Command Rail / Open Cell: Command Cell")
    ).toBeInTheDocument();

    pressCommandInputKey("ArrowLeft");

    await waitFor(() => {
      expect(input).toHaveValue("open command");
    });
    expect(
      screen.getByTestId("command-menu-item-open-cell-cell-1")
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Go to Overview")).not.toBeInTheDocument();
  });

  it("closes the menu with Escape from a cell action scope", async () => {
    renderCommandMenu();
    openCommandMenu();
    await moveSelectionToCommand("command-menu-item-open-cell-cell-1");
    pressCommandInputKey("ArrowRight");

    pressCommandInputKey("Escape");

    await waitFor(() => {
      expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
    });
  });

  it("keeps Enter as the default action for commands with children", async () => {
    renderCommandMenu();
    openCommandMenu();
    await moveSelectionToCommand("command-menu-item-open-cell-cell-1");

    pressCommandInputKey("Enter");

    expect(navigateMock).toHaveBeenCalledWith(
      cellNavigation({
        cellId: "cell-1",
        to: "/cells/$cellId/chat",
        workspaceId: "workspace-1",
      })
    );
  });

  it("moves selection to the best command when searching", async () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "theme" } }
    );

    await waitFor(() => {
      expect(screen.getByTestId("command-menu-item-theme-system")).toHaveClass(
        "border-primary"
      );
    });
    expect(
      screen.queryByTestId("command-menu-item-nav-overview")
    ).not.toBeInTheDocument();
  });

  it("selects the best command when async cell results arrive", async () => {
    queriedCellsByWorkspace = new Map([
      ["workspace-1", []],
      ["workspace-2", []],
    ]);
    const callbacks = {
      onCreateCell: vi.fn(),
      onManageWorkspaces: vi.fn(),
      onRegisterWorkspace: vi.fn(),
    };
    const { rerender } = render(<CommandMenu {...callbacks} />);
    openCommandMenu();
    const input = screen.getByPlaceholderText(
      "Search commands, cells, workspaces..."
    );

    fireEvent.input(input, { target: { value: "shell command" } });
    expect(
      screen.queryByTestId(
        "command-menu-item-cell-page-cell-1-/cells/$cellId/terminal"
      )
    ).not.toBeInTheDocument();

    queriedCellsByWorkspace = cellsByWorkspace;
    rerender(<CommandMenu {...callbacks} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "command-menu-item-cell-page-cell-1-/cells/$cellId/terminal"
        )
      ).toHaveAttribute("aria-selected", "true");
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith(
      cellNavigation({
        cellId: "cell-1",
        to: "/cells/$cellId/terminal",
        workspaceId: "workspace-1",
      })
    );
  });

  it("supports fuzzy command search", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "linr" } }
    );

    expect(screen.getByTestId("command-menu-item-nav-linear")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("does not fuzzy-match unrelated descriptions or keywords", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "asd" } }
    );

    expect(screen.queryByText("Go to Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage Workspaces")).not.toBeInTheDocument();
  });

  it("deduplicates equivalent create-cell actions", () => {
    renderCommandMenu();
    openCommandMenu();

    expect(screen.getByText("Create Cell")).toBeInTheDocument();
    expect(
      screen.queryByText("Create Cell in Workspace One")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Create Cell in Workspace Two")
    ).toBeInTheDocument();
  });

  it("deduplicates current-cell open actions that route to the current tab", () => {
    currentPathname = "/cells/cell-1/chat";
    currentRouteId = "/cells/$cellId/chat";
    currentCellId = "cell-1";
    renderCommandMenu();
    openCommandMenu();

    expect(screen.getByText("Cell Chat")).toBeInTheDocument();
    expect(
      screen.queryByText("Open Cell: Command Cell")
    ).not.toBeInTheDocument();
  });

  it("switches to another cell from the current cell context via search", () => {
    currentPathname = "/cells/cell-1/chat";
    currentRouteId = "/cells/$cellId/chat";
    currentCellId = "cell-1";
    renderCommandMenu();
    openCommandMenu();
    const input = screen.getByPlaceholderText(
      "Search commands, cells, workspaces..."
    );

    expect(screen.getByText("Cell Chat")).toBeInTheDocument();
    fireEvent.input(input, { target: { value: "open provisioning" } });

    expect(
      screen.getByTestId("command-menu-item-open-cell-cell-2")
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith(
      cellNavigation({
        cellId: "cell-2",
        to: "/cells/$cellId/provisioning",
        workspaceId: "workspace-2",
      })
    );
  });

  it("shows specific cell page commands from non-cell routes while searching", () => {
    renderCommandMenu();
    openCommandMenu();

    expect(screen.getByText("Open Cell: Command Cell")).toBeInTheDocument();
    expect(
      screen.queryByText("Command Cell: Terminal")
    ).not.toBeInTheDocument();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "command cell" } }
    );

    fireEvent.click(screen.getByText("Command Cell: Terminal"));

    expect(navigateMock.mock.lastCall?.[0]).toEqual(
      cellNavigation({
        cellId: "cell-1",
        to: "/cells/$cellId/terminal",
        workspaceId: "workspace-1",
      })
    );
  });

  it("matches cell page commands when search terms are reversed", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "info command" } }
    );

    expect(screen.getByText("Command Cell: Info")).toBeInTheDocument();
  });

  it("uses page aliases and context descriptions for cell page results", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "shell command" } }
    );

    const terminalCommand = screen.getByTestId(
      "command-menu-item-cell-page-cell-1-/cells/$cellId/terminal"
    );
    const visibleItems = screen.getAllByTestId((_content, element) =>
      Boolean(
        element?.getAttribute("data-testid")?.startsWith("command-menu-item-")
      )
    );

    expect(visibleItems[0]).toBe(terminalCommand);
    expect(
      within(terminalCommand).getByText("Command Cell: Terminal")
    ).toBeInTheDocument();
    expect(
      within(terminalCommand).getByText(
        "Command Cell / Terminal / Workspace One"
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Open Cell: Command Cell")
    ).not.toBeInTheDocument();
  });

  it("shows only the Right Arrow drill-in hint while searching", () => {
    renderCommandMenu();
    openCommandMenu();

    fireEvent.input(
      screen.getByPlaceholderText("Search commands, cells, workspaces..."),
      { target: { value: "open command" } }
    );

    const openCellCommand = screen.getByTestId(
      "command-menu-item-open-cell-cell-1"
    );
    expect(within(openCellCommand).getByText("Right")).toBeInTheDocument();
    expect(
      within(openCellCommand).queryByText("Right / Space")
    ).not.toBeInTheDocument();
  });
});
