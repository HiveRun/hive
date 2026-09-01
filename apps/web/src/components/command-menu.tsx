import {
  Content as DialogContent,
  Description as DialogDescription,
  Overlay as DialogOverlay,
  Portal as DialogPortal,
  Root as DialogRoot,
  Title as DialogTitle,
} from "@radix-ui/react-dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Code2,
  Cpu,
  GitCompareArrows,
  Home,
  Monitor,
  Moon,
  Plus,
  Search,
  Server,
  Settings2,
  Sun,
  Terminal,
  Ticket,
} from "lucide-react";
import { type KeyOption, matchSorter, rankings } from "match-sorter";
import type { ComponentType, SVGProps } from "react";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { type CellSummary, cellQueries } from "@/queries/cells";
import { type WorkspaceSummary, workspaceQueries } from "@/queries/workspaces";

type CommandMenuProps = {
  onCreateCell: (workspaceId?: string) => void;
  onManageWorkspaces: () => void;
  onRegisterWorkspace: () => void;
};

type CellCommandEntry = {
  cell: CellSummary;
  workspace: WorkspaceSummary;
};

type NavigateFunction = ReturnType<typeof useNavigate>;
type RunCommand = (action: () => void) => void;

type CellCommandBuilderArgs = {
  allCells: CellCommandEntry[];
  currentCellId?: string;
  navigate: NavigateFunction;
  runCommand: RunCommand;
};

type CommandGroupId =
  | "navigation"
  | "cell"
  | "open-cells"
  | "workspace"
  | "theme";

type CommandIcon = ComponentType<SVGProps<SVGSVGElement>>;

type CommandAction = {
  id: string;
  label: string;
  description?: string;
  group: CommandGroupId;
  icon: CommandIcon;
  keywords?: string[];
  basePriority: number;
  contextual?: boolean;
  current?: boolean;
  searchOnly?: boolean;
  dedupe?: {
    key: string;
    priority: number;
  };
  children?: CommandAction[];
  onSelect: () => void;
};

type CommandStackFrameState = {
  searchValue: string;
  selectedCommandValue: string;
};

type CommandScopeFrame = CommandStackFrameState & {
  title: string;
  commands: CommandAction[];
};

type CommandMenuStackState = {
  root: CommandStackFrameState;
  scopes: CommandScopeFrame[];
};

type CommandMenuStackAction =
  | { type: "reset" }
  | { type: "openRoot"; selectedCommandValue: string }
  | { type: "setSearch"; searchValue: string; selectedCommandValue: string }
  | { type: "setSelection"; selectedCommandValue: string }
  | {
      type: "pushScope";
      commands: CommandAction[];
      selectedCommandValue: string;
      title: string;
    }
  | { type: "popScope" };

type CommandGroupDefinition = {
  id: CommandGroupId;
  heading: string;
};

type CellTabCommand = {
  routeId: string;
  label: string;
  to: string;
  icon: CommandIcon;
  basePriority: number;
  aliases: string[];
};

const COMMAND_GROUPS: CommandGroupDefinition[] = [
  { id: "navigation", heading: "Navigation" },
  { id: "cell", heading: "Current Cell" },
  { id: "open-cells", heading: "Open Cells" },
  { id: "workspace", heading: "Workspace" },
  { id: "theme", heading: "Theme" },
];

const CELL_TAB_COMMANDS: CellTabCommand[] = [
  {
    routeId: "/cells/$cellId/setup",
    label: "Cell Info",
    to: "/cells/$cellId/setup",
    icon: Settings2,
    basePriority: 80,
    aliases: ["info", "details", "setup", "metadata", "config", "overview"],
  },
  {
    routeId: "/cells/$cellId/services",
    label: "Cell Services",
    to: "/cells/$cellId/services",
    icon: Server,
    basePriority: 70,
    aliases: ["services", "service", "logs", "processes", "ports", "status"],
  },
  {
    routeId: "/cells/$cellId/viewer",
    label: "Cell Viewer",
    to: "/cells/$cellId/viewer",
    icon: Monitor,
    basePriority: 60,
    aliases: ["viewer", "preview", "browser", "web", "app", "site"],
  },
  {
    routeId: "/cells/$cellId/terminal",
    label: "Cell Terminal",
    to: "/cells/$cellId/terminal",
    icon: Terminal,
    basePriority: 50,
    aliases: ["terminal", "shell", "console", "cli", "command", "tty"],
  },
  {
    routeId: "/cells/$cellId/diff",
    label: "Cell Diff",
    to: "/cells/$cellId/diff",
    icon: GitCompareArrows,
    basePriority: 40,
    aliases: ["diff", "changes", "git", "review", "compare", "patch"],
  },
  {
    routeId: "/cells/$cellId/chat",
    label: "Cell Chat",
    to: "/cells/$cellId/chat",
    icon: Bot,
    basePriority: 30,
    aliases: ["chat", "agent", "conversation", "prompt", "messages"],
  },
];

const PROVISIONING_COMMAND: CellTabCommand = {
  routeId: "/cells/$cellId/provisioning",
  label: "Cell Provisioning",
  to: "/cells/$cellId/provisioning",
  icon: Code2,
  basePriority: 90,
  aliases: ["provisioning", "setup", "install", "build", "bootstrap", "logs"],
};

const CONTEXT_BOOST = 1000;
const CURRENT_BOOST = 2000;
const CREATE_CELL_ROUTE_PRIORITY = 110;
const CREATE_CELL_BASE_PRIORITY = 80;
const MANAGE_WORKSPACES_PRIORITY = 70;
const REGISTER_WORKSPACE_EMPTY_PRIORITY = 120;
const REGISTER_WORKSPACE_BASE_PRIORITY = 60;
const CURRENT_CELL_OPEN_PRIORITY = 100;
const READY_CELL_OPEN_PRIORITY = 50;
const NON_READY_CELL_OPEN_PRIORITY = 40;
const ACTIVE_WORKSPACE_CREATE_PRIORITY = 80;
const WORKSPACE_CREATE_PRIORITY = 40;
const THEME_LIGHT_PRIORITY = 30;
const THEME_DARK_PRIORITY = 20;
const THEME_SYSTEM_PRIORITY = 10;
const PRIMARY_ACTION_DEDUPE_PRIORITY = 100;
const CONTEXTUAL_ACTION_DEDUPE_PRIORITY = 80;
const EMPTY_COMMAND_FRAME: CommandStackFrameState = {
  searchValue: "",
  selectedCommandValue: "",
};
const INITIAL_COMMAND_STACK_STATE: CommandMenuStackState = {
  root: EMPTY_COMMAND_FRAME,
  scopes: [],
};

const COMMAND_GROUP_ORDER = new Map(
  COMMAND_GROUPS.map((group, index) => [group.id, index])
);
const SEARCH_TOKEN_SEPARATOR = /\s+/;

const COMMAND_SEARCH_KEYS: readonly KeyOption<CommandAction>[] = [
  { key: "label", threshold: rankings.MATCHES },
  {
    key: (command) => getCommandGroupHeading(command.group),
    threshold: rankings.CONTAINS,
  },
  { key: (command) => command.keywords ?? [], threshold: rankings.CONTAINS },
  { key: "description", threshold: rankings.CONTAINS },
];

const updateActiveCommandFrame = (
  state: CommandMenuStackState,
  patch: Partial<CommandStackFrameState>
): CommandMenuStackState => {
  if (state.scopes.length === 0) {
    return { ...state, root: { ...state.root, ...patch } };
  }

  const nextScopes = [...state.scopes];
  const activeScope = nextScopes.at(-1);
  if (!activeScope) {
    return state;
  }
  nextScopes[nextScopes.length - 1] = { ...activeScope, ...patch };
  return { ...state, scopes: nextScopes };
};

const commandMenuStackReducer = (
  state: CommandMenuStackState,
  action: CommandMenuStackAction
): CommandMenuStackState => {
  switch (action.type) {
    case "reset":
      return INITIAL_COMMAND_STACK_STATE;
    case "openRoot":
      return {
        root: {
          searchValue: "",
          selectedCommandValue: action.selectedCommandValue,
        },
        scopes: [],
      };
    case "setSearch":
      return updateActiveCommandFrame(state, {
        searchValue: action.searchValue,
        selectedCommandValue: action.selectedCommandValue,
      });
    case "setSelection":
      return updateActiveCommandFrame(state, {
        selectedCommandValue: action.selectedCommandValue,
      });
    case "pushScope":
      return {
        ...state,
        scopes: [
          ...state.scopes,
          {
            commands: action.commands,
            searchValue: "",
            selectedCommandValue: action.selectedCommandValue,
            title: action.title,
          },
        ],
      };
    case "popScope":
      if (state.scopes.length === 0) {
        return state;
      }
      return { ...state, scopes: state.scopes.slice(0, -1) };
    default:
      return state;
  }
};

const getActiveCommandFrameState = (state: CommandMenuStackState) =>
  state.scopes.at(-1) ?? state.root;

const useCommandMenuStack = () => {
  const [state, dispatch] = useReducer(
    commandMenuStackReducer,
    INITIAL_COMMAND_STACK_STATE
  );
  const activeFrame = getActiveCommandFrameState(state);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const openRoot = useCallback(
    (selectedCommandValue: string) =>
      dispatch({ type: "openRoot", selectedCommandValue }),
    []
  );
  const popScope = useCallback(() => dispatch({ type: "popScope" }), []);
  const pushScope = useCallback(
    (args: {
      commands: CommandAction[];
      selectedCommandValue: string;
      title: string;
    }) => dispatch({ type: "pushScope", ...args }),
    []
  );
  const setSearch = useCallback(
    (args: { searchValue: string; selectedCommandValue: string }) =>
      dispatch({ type: "setSearch", ...args }),
    []
  );
  const setSelection = useCallback(
    (selectedCommandValue: string) =>
      dispatch({ type: "setSelection", selectedCommandValue }),
    []
  );

  return useMemo(
    () => ({
      activeScope: state.scopes.at(-1),
      canLeaveScope: state.scopes.length > 0,
      openRoot,
      popScope,
      pushScope,
      reset,
      searchValue: activeFrame.searchValue,
      selectedCommandValue: activeFrame.selectedCommandValue,
      setSearch,
      setSelection,
    }),
    [
      activeFrame.searchValue,
      activeFrame.selectedCommandValue,
      openRoot,
      popScope,
      pushScope,
      reset,
      setSearch,
      setSelection,
      state.scopes,
    ]
  );
};

const isEditableShortcutTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.closest(
      '.xterm, [data-testid="cell-terminal"], [data-testid="cell-terminal-input"]'
    )
  ) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"]'
    )
  );
};

const getNavigationDedupeKey = (target: string) => `navigate:${target}`;

const getCellNavigationDedupeKey = (args: { cellId: string; to: string }) =>
  getNavigationDedupeKey(`${args.to}:${args.cellId}`);

const getCellRouteTarget = (cell: Pick<CellSummary, "status">) =>
  cell.status === "ready"
    ? "/cells/$cellId/chat"
    : "/cells/$cellId/provisioning";

const getOpenCellPriority = (args: {
  cell: CellSummary;
  isCurrentCell: boolean;
}) => {
  const { cell, isCurrentCell } = args;
  if (isCurrentCell) {
    return CURRENT_CELL_OPEN_PRIORITY;
  }
  if (cell.status === "ready") {
    return READY_CELL_OPEN_PRIORITY;
  }
  return NON_READY_CELL_OPEN_PRIORITY;
};

const buildCellListQueryConfig = (workspaceId: string, enabled: boolean) => ({
  ...cellQueries.all(workspaceId),
  enabled,
  staleTime: 5000,
});

const getCellTabName = (tab: CellTabCommand) => tab.label.replace("Cell ", "");

const getCellPageDescription = (args: {
  cellName: string;
  tab: CellTabCommand;
  workspaceLabel?: string;
}) =>
  [args.cellName, getCellTabName(args.tab), args.workspaceLabel]
    .filter((value): value is string => Boolean(value))
    .join(" / ");

const selectCellRoute = (args: {
  cellId: string;
  navigate: NavigateFunction;
  runCommand: RunCommand;
  to: string;
  workspaceId?: string;
}) => {
  const { cellId, navigate, runCommand, to, workspaceId } = args;
  return () =>
    runCommand(() => {
      if (workspaceId) {
        navigate({
          to,
          params: { cellId },
          search: { workspaceId },
        });
        return;
      }

      navigate({
        to,
        params: { cellId },
      });
    });
};

const getCellPagePriority = ({
  cell,
  isCurrentCell,
}: {
  cell: CellSummary;
  isCurrentCell: boolean;
}) =>
  isCurrentCell
    ? CURRENT_CELL_OPEN_PRIORITY
    : getOpenCellPriority({ cell, isCurrentCell: false }) - 1;

const buildCellPageCommand = (args: {
  cell: CellSummary;
  currentCellId?: string;
  navigate: NavigateFunction;
  runCommand: RunCommand;
  tab: CellTabCommand;
  workspace: WorkspaceSummary;
  scoped?: boolean;
}): CommandAction => {
  const { cell, currentCellId, navigate, runCommand, scoped, tab, workspace } =
    args;
  const isCurrentCell = cell.id === currentCellId;
  const tabName = getCellTabName(tab);
  return {
    id: `${scoped ? "cell-scope" : "cell-page"}-${cell.id}-${tab.routeId}`,
    label: scoped ? `Open ${tabName}` : `${cell.name}: ${tabName}`,
    description: getCellPageDescription({
      cellName: cell.name,
      tab,
      workspaceLabel: workspace.label,
    }),
    group: scoped ? "cell" : "open-cells",
    icon: tab.icon,
    basePriority: scoped
      ? tab.basePriority
      : getCellPagePriority({ cell, isCurrentCell }),
    contextual: isCurrentCell,
    searchOnly: scoped ? undefined : true,
    dedupe:
      isCurrentCell && !scoped
        ? {
            key: getCellNavigationDedupeKey({ cellId: cell.id, to: tab.to }),
            priority: CONTEXTUAL_ACTION_DEDUPE_PRIORITY,
          }
        : undefined,
    keywords: [
      cell.id,
      cell.name,
      workspace.label,
      tab.label,
      tabName,
      ...tab.aliases,
    ],
    onSelect: selectCellRoute({
      cellId: cell.id,
      navigate,
      runCommand,
      to: tab.to,
      workspaceId: workspace.id,
    }),
  } satisfies CommandAction;
};

const getCommandPriority = (command: CommandAction) =>
  command.basePriority +
  (command.contextual ? CONTEXT_BOOST : 0) +
  (command.current ? CURRENT_BOOST : 0);

const getCommandValue = (command: CommandAction) => command.id;

const dedupeCommands = (commands: CommandAction[]) => {
  const selectedByKey = new Map<string, CommandAction>();
  const passthroughCommands: CommandAction[] = [];

  for (const command of commands) {
    if (!command.dedupe) {
      passthroughCommands.push(command);
      continue;
    }

    const existingCommand = selectedByKey.get(command.dedupe.key);
    if (
      !existingCommand ||
      command.dedupe.priority > (existingCommand.dedupe?.priority ?? 0)
    ) {
      selectedByKey.set(command.dedupe.key, command);
    }
  }

  const selectedCommands = new Set(selectedByKey.values());
  return commands.filter(
    (command) => !command.dedupe || selectedCommands.has(command)
  );
};

const isCommandVisuallySelected = (args: {
  command: CommandAction;
  selectedCommandValue: string;
}) => args.selectedCommandValue === getCommandValue(args.command);

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

const getSearchTokens = (query: string) =>
  query.split(SEARCH_TOKEN_SEPARATOR).filter((token) => token.length > 0);

const getCommandGroupHeading = (groupId: CommandGroupId) =>
  COMMAND_GROUPS.find((group) => group.id === groupId)?.heading ?? groupId;

const getStrictCommandSearchText = (command: CommandAction) =>
  [
    getCommandGroupHeading(command.group),
    command.description,
    ...(command.keywords ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

const matchesSearchToken = (command: CommandAction, token: string) => {
  const labelMatches = matchSorter([command], token, {
    keys: [{ key: "label", threshold: rankings.MATCHES }],
    threshold: rankings.MATCHES,
  });

  return (
    labelMatches.length > 0 ||
    getStrictCommandSearchText(command).includes(token)
  );
};

const getTokenMatchedCommands = (commands: CommandAction[], query: string) => {
  const tokens = getSearchTokens(query);
  if (tokens.length < 2) {
    return commands;
  }

  return commands.filter((command) =>
    tokens.every((token) => matchesSearchToken(command, token))
  );
};

const sortCommands = (commands: CommandAction[]) =>
  [...commands].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (left.contextual !== right.contextual) {
      return left.contextual ? -1 : 1;
    }

    const priorityDiff = getCommandPriority(right) - getCommandPriority(left);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.label.localeCompare(right.label);
  });

const getGroupedCommandOrder = (command: CommandAction) =>
  COMMAND_GROUP_ORDER.get(command.group) ?? COMMAND_GROUPS.length;

const sortCommandsByGroup = (commands: CommandAction[]) =>
  [...commands].sort((left, right) => {
    const groupDiff =
      getGroupedCommandOrder(left) - getGroupedCommandOrder(right);
    if (groupDiff !== 0) {
      return groupDiff;
    }
    return sortCommands([left, right])[0] === left ? -1 : 1;
  });

const getVisibleCommandList = (args: {
  commands: CommandAction[];
  search: string;
}) => {
  const query = normalizeSearchText(args.search);
  const visibleCommands = query
    ? args.commands
    : args.commands.filter((command) => !command.searchOnly);
  const orderedCommands = sortCommandsByGroup(visibleCommands);
  if (!query) {
    return orderedCommands;
  }

  const hasTokenFilter = getSearchTokens(query).length > 1;
  const tokenMatchedCommands = getTokenMatchedCommands(orderedCommands, query);
  const rankedCommands = matchSorter(tokenMatchedCommands, query, {
    baseSort: (left, right) => left.index - right.index,
    keys: COMMAND_SEARCH_KEYS,
    threshold: rankings.MATCHES,
  });

  return rankedCommands.length > 0 || !hasTokenFilter
    ? rankedCommands
    : tokenMatchedCommands;
};

const getBestCommandForSearch = (commands: CommandAction[], search: string) =>
  getVisibleCommandList({ commands, search })[0];

const isCommandArrowKey = (key: string) =>
  key === "ArrowDown" || key === "ArrowUp";

const getNextCommandValue = (args: {
  direction: "ArrowDown" | "ArrowUp";
  selectedCommandValue: string;
  visibleCommands: CommandAction[];
}) => {
  const { direction, selectedCommandValue, visibleCommands } = args;
  if (visibleCommands.length === 0) {
    return;
  }

  const selectedIndex = visibleCommands.findIndex(
    (command) => getCommandValue(command) === selectedCommandValue
  );
  const nextIndex =
    direction === "ArrowDown"
      ? (selectedIndex + 1) % visibleCommands.length
      : (selectedIndex - 1 + visibleCommands.length) % visibleCommands.length;
  const nextCommand = visibleCommands[nextIndex];
  return nextCommand ? getCommandValue(nextCommand) : undefined;
};

const resolveCellId = (
  matches: Array<{ routeId: string; params?: unknown }>
) => {
  const cellMatch = matches.find((match) => match.routeId === "/cells/$cellId");
  if (!cellMatch?.params || typeof cellMatch.params !== "object") {
    return;
  }

  const cellId = (cellMatch.params as { cellId?: unknown }).cellId;
  return typeof cellId === "string" ? cellId : undefined;
};

const resolveWorkspaceIdFromSearch = (search: unknown) => {
  if (!search || typeof search !== "object") {
    return;
  }

  const workspaceId = (search as { workspaceId?: unknown }).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
};

const buildNavigationCommands = (args: {
  fallbackWorkspaceId?: string;
  navigate: NavigateFunction;
  onCreateCell: (workspaceId?: string) => void;
  onManageWorkspaces: () => void;
  onRegisterWorkspace: () => void;
  pathname: string;
  runCommand: RunCommand;
  workspaceContextId?: string;
  workspaces: WorkspaceSummary[];
}): CommandAction[] => {
  const {
    fallbackWorkspaceId,
    navigate,
    onCreateCell,
    onManageWorkspaces,
    onRegisterWorkspace,
    pathname,
    runCommand,
    workspaceContextId,
    workspaces,
  } = args;
  const isCellCreationRoute = pathname === "/cells/new";
  const createCellPriority = isCellCreationRoute
    ? CREATE_CELL_ROUTE_PRIORITY
    : CREATE_CELL_BASE_PRIORITY;
  const registerWorkspacePriority =
    workspaces.length === 0
      ? REGISTER_WORKSPACE_EMPTY_PRIORITY
      : REGISTER_WORKSPACE_BASE_PRIORITY;

  return [
    {
      id: "nav-overview",
      label: "Go to Overview",
      description: "Return to the Hive mission overview.",
      group: "navigation",
      icon: Home,
      basePriority: CURRENT_CELL_OPEN_PRIORITY,
      current: pathname === "/",
      keywords: ["home", "dashboard", "hive"],
      onSelect: () => runCommand(() => navigate({ to: "/" })),
    },
    {
      id: "nav-linear",
      label: "Go to Linear",
      description: "Open issue intake and Linear workspace tools.",
      group: "navigation",
      icon: Ticket,
      basePriority: PROVISIONING_COMMAND.basePriority,
      current: pathname.startsWith("/linear"),
      keywords: ["issues", "tickets", "integration"],
      onSelect: () =>
        runCommand(() => {
          if (workspaceContextId) {
            navigate({
              to: "/linear",
              search: { workspaceId: workspaceContextId },
            });
            return;
          }

          navigate({ to: "/linear" });
        }),
    },
    {
      id: "nav-android-runtime",
      label: "Go to Android Runtime Lab",
      description: "Explore simulated Android lifecycle and isolation flows.",
      group: "navigation",
      icon: Cpu,
      basePriority: PROVISIONING_COMMAND.basePriority - 1,
      current: pathname === "/android-runtime",
      keywords: [
        "android",
        "runtime",
        "emulator",
        "viewer",
        "microphone",
        "recovery",
        "adb",
      ],
      onSelect: () => runCommand(() => navigate({ to: "/android-runtime" })),
    },
    {
      id: "action-create-cell",
      label: "Create Cell",
      description: fallbackWorkspaceId
        ? "Open the cell creation sheet for the active workspace."
        : "Register a workspace before creating a cell.",
      group: "navigation",
      icon: Plus,
      basePriority: createCellPriority,
      contextual: isCellCreationRoute,
      current: isCellCreationRoute,
      dedupe: {
        key: fallbackWorkspaceId
          ? `create-cell:${fallbackWorkspaceId}`
          : "register-workspace",
        priority: PRIMARY_ACTION_DEDUPE_PRIORITY,
      },
      keywords: ["new", "agent", "task"],
      onSelect: () =>
        runCommand(() => {
          if (fallbackWorkspaceId) {
            onCreateCell(fallbackWorkspaceId);
            return;
          }
          onRegisterWorkspace();
        }),
    },
    {
      id: "action-manage-workspaces",
      label: "Manage Workspaces",
      description: "Review, activate, or remove registered workspaces.",
      group: "navigation",
      icon: Settings2,
      basePriority: MANAGE_WORKSPACES_PRIORITY,
      keywords: ["workspace", "registry", "projects"],
      onSelect: () => runCommand(onManageWorkspaces),
    },
    {
      id: "action-register-workspace",
      label: "Register Workspace",
      description: "Attach another repository or directory to Hive.",
      group: "navigation",
      icon: Plus,
      basePriority: registerWorkspacePriority,
      contextual: workspaces.length === 0,
      dedupe: {
        key: "register-workspace",
        priority: CONTEXTUAL_ACTION_DEDUPE_PRIORITY,
      },
      keywords: ["add workspace", "directory", "repo"],
      onSelect: () => runCommand(onRegisterWorkspace),
    },
  ];
};

const buildCellTabCommands = (args: {
  activeRouteId?: string;
  currentCell?: CellSummary;
  currentCellId?: string;
  navigate: NavigateFunction;
  runCommand: RunCommand;
}): CommandAction[] => {
  const { activeRouteId, currentCell, currentCellId, navigate, runCommand } =
    args;
  if (!currentCellId) {
    return [];
  }

  const shouldShowProvisioning =
    activeRouteId === PROVISIONING_COMMAND.routeId ||
    (currentCell ? currentCell.status !== "ready" : false);
  const cellCommands = [
    ...(shouldShowProvisioning ? [PROVISIONING_COMMAND] : []),
    ...CELL_TAB_COMMANDS,
  ];

  return cellCommands.map((tab) => ({
    id: `cell-tab-${tab.routeId}`,
    label: tab.label,
    description: currentCell
      ? getCellPageDescription({ cellName: currentCell.name, tab })
      : "Open this cell section.",
    group: "cell",
    icon: tab.icon,
    basePriority: tab.basePriority,
    contextual: true,
    current: activeRouteId === tab.routeId,
    dedupe: {
      key: getCellNavigationDedupeKey({ cellId: currentCellId, to: tab.to }),
      priority: PRIMARY_ACTION_DEDUPE_PRIORITY,
    },
    keywords: [
      currentCellId,
      tab.label,
      getCellTabName(tab),
      currentCell?.name ?? "",
      ...tab.aliases,
    ],
    onSelect: selectCellRoute({
      cellId: currentCellId,
      navigate,
      runCommand,
      to: tab.to,
    }),
  }));
};

function buildOpenCellCommands({
  allCells,
  currentCellId,
  navigate,
  runCommand,
}: CellCommandBuilderArgs): CommandAction[] {
  return allCells.map(({ cell, workspace }) => {
    const isCurrentCell = cell.id === currentCellId;
    const targetRoute = getCellRouteTarget(cell);
    const childCommands = getCellPageCommands(cell).map((tab) =>
      buildCellPageCommand({
        cell,
        currentCellId,
        navigate,
        runCommand,
        scoped: true,
        tab,
        workspace,
      })
    );
    return {
      id: `open-cell-${cell.id}`,
      label: `Open Cell: ${cell.name}`,
      description: `${workspace.label} / ${cell.status}`,
      group: "open-cells",
      icon: Bot,
      basePriority: getOpenCellPriority({ cell, isCurrentCell }),
      contextual: isCurrentCell,
      current: isCurrentCell,
      dedupe: {
        key: getCellNavigationDedupeKey({ cellId: cell.id, to: targetRoute }),
        priority: CONTEXTUAL_ACTION_DEDUPE_PRIORITY,
      },
      keywords: [
        cell.id,
        cell.name,
        cell.branchName ?? "",
        cell.status,
        workspace.label,
      ],
      children: childCommands,
      onSelect: selectCellRoute({
        cellId: cell.id,
        navigate,
        runCommand,
        to: targetRoute,
        workspaceId: workspace.id,
      }),
    } satisfies CommandAction;
  });
}

const getCellPageCommands = (cell: CellSummary): CellTabCommand[] => {
  if (cell.status !== "ready") {
    return [PROVISIONING_COMMAND, ...CELL_TAB_COMMANDS.slice(0, 1)];
  }
  return CELL_TAB_COMMANDS;
};

const buildCellPageCommands = (
  args: CellCommandBuilderArgs
): CommandAction[] => {
  const { allCells, currentCellId, navigate, runCommand } = args;

  return allCells.flatMap(({ cell, workspace }) =>
    getCellPageCommands(cell).map((tab) =>
      buildCellPageCommand({
        cell,
        currentCellId,
        navigate,
        runCommand,
        tab,
        workspace,
      })
    )
  );
};

const buildWorkspaceCommands = (args: {
  workspaceContextId?: string;
  onCreateCell: (workspaceId?: string) => void;
  runCommand: RunCommand;
  workspaces: WorkspaceSummary[];
}): CommandAction[] => {
  const { workspaceContextId, onCreateCell, runCommand, workspaces } = args;

  return workspaces.map((workspace) => {
    const isActiveWorkspace = workspace.id === workspaceContextId;
    return {
      id: `create-cell-${workspace.id}`,
      label: `Create Cell in ${workspace.label}`,
      description: workspace.path,
      group: "workspace",
      icon: Plus,
      basePriority: isActiveWorkspace
        ? ACTIVE_WORKSPACE_CREATE_PRIORITY
        : WORKSPACE_CREATE_PRIORITY,
      contextual: isActiveWorkspace,
      dedupe: {
        key: `create-cell:${workspace.id}`,
        priority: CONTEXTUAL_ACTION_DEDUPE_PRIORITY,
      },
      keywords: [workspace.id, workspace.label, workspace.path, "new cell"],
      onSelect: () => runCommand(() => onCreateCell(workspace.id)),
    } satisfies CommandAction;
  });
};

const buildThemeCommands = (args: {
  runCommand: RunCommand;
  setTheme: (theme: "dark" | "light" | "system") => void;
  theme: "dark" | "light" | "system";
}): CommandAction[] => {
  const { runCommand, setTheme, theme } = args;

  return [
    {
      id: "theme-light",
      label: "Set Theme: Light",
      description: "Use the bright inspection theme.",
      group: "theme",
      icon: Sun,
      basePriority: THEME_LIGHT_PRIORITY,
      current: theme === "light",
      keywords: ["appearance", "mode"],
      onSelect: () => runCommand(() => setTheme("light")),
    },
    {
      id: "theme-dark",
      label: "Set Theme: Dark",
      description: "Use the obsidian command deck theme.",
      group: "theme",
      icon: Moon,
      basePriority: THEME_DARK_PRIORITY,
      current: theme === "dark",
      keywords: ["appearance", "mode"],
      onSelect: () => runCommand(() => setTheme("dark")),
    },
    {
      id: "theme-system",
      label: "Set Theme: System",
      description: "Follow your operating system preference.",
      group: "theme",
      icon: Monitor,
      basePriority: THEME_SYSTEM_PRIORITY,
      current: theme === "system",
      keywords: ["appearance", "mode", "auto"],
      onSelect: () => runCommand(() => setTheme("system")),
    },
  ];
};

export function CommandMenu({
  onCreateCell,
  onManageWorkspaces,
  onRegisterWorkspace,
}: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const commandStack = useCommandMenuStack();
  const {
    activeScope: currentScope,
    canLeaveScope,
    openRoot,
    popScope,
    pushScope,
    reset: resetCommandStack,
    searchValue,
    selectedCommandValue,
    setSearch,
    setSelection,
  } = commandStack;
  const navigate = useNavigate();
  const routerState = useRouterState({
    select: (state) => ({
      matches: state.matches.map((match) => ({
        params: match.params,
        routeId: match.routeId,
      })),
      pathname: state.location.pathname,
      search: state.location.search,
    }),
  });
  const activeRouteId = routerState.matches.at(-1)?.routeId;
  const currentCellId = resolveCellId(routerState.matches);
  const { setTheme, theme } = useTheme();
  const workspaceQuery = useQuery(workspaceQueries.list());
  const workspaces = workspaceQuery.data?.workspaces ?? [];
  const activeWorkspaceId = workspaceQuery.data?.activeWorkspaceId ?? undefined;
  const workspaceIdFromSearch = resolveWorkspaceIdFromSearch(
    routerState.search
  );

  const cellListQueries = useQueries({
    queries: workspaces.map((workspace) =>
      buildCellListQueryConfig(workspace.id, open)
    ),
  });

  const allCells: CellCommandEntry[] = workspaces.flatMap((workspace, index) =>
    (cellListQueries[index]?.data ?? []).map((cell) => ({ cell, workspace }))
  );
  const currentCell = allCells.find(
    ({ cell }) => cell.id === currentCellId
  )?.cell;
  const workspaceContextId =
    workspaceIdFromSearch ?? currentCell?.workspaceId ?? activeWorkspaceId;
  const fallbackWorkspaceId = workspaceContextId ?? workspaces[0]?.id;

  const runCommand = useCallback(
    (action: () => void) => {
      resetCommandStack();
      setOpen(false);
      action();
    },
    [resetCommandStack]
  );

  const commands = useMemo<CommandAction[]>(
    () =>
      dedupeCommands([
        ...buildNavigationCommands({
          fallbackWorkspaceId,
          navigate,
          onCreateCell,
          onManageWorkspaces,
          onRegisterWorkspace,
          pathname: routerState.pathname,
          runCommand,
          workspaceContextId,
          workspaces,
        }),
        ...buildCellTabCommands({
          activeRouteId,
          currentCell,
          currentCellId,
          navigate,
          runCommand,
        }),
        ...buildOpenCellCommands({
          allCells,
          currentCellId,
          navigate,
          runCommand,
        }),
        ...buildCellPageCommands({
          allCells,
          currentCellId,
          navigate,
          runCommand,
        }),
        ...buildWorkspaceCommands({
          workspaceContextId: fallbackWorkspaceId,
          onCreateCell,
          runCommand,
          workspaces,
        }),
        ...buildThemeCommands({ runCommand, setTheme, theme }),
      ]),
    [
      activeRouteId,
      allCells,
      currentCell,
      currentCellId,
      fallbackWorkspaceId,
      navigate,
      onCreateCell,
      onManageWorkspaces,
      onRegisterWorkspace,
      routerState.pathname,
      runCommand,
      setTheme,
      theme,
      workspaceContextId,
      workspaces,
    ]
  );

  const activeCommands = currentScope?.commands ?? commands;
  const commandByValue = useMemo(
    () =>
      new Map(
        activeCommands.map(
          (command) => [getCommandValue(command), command] as const
        )
      ),
    [activeCommands]
  );
  const visibleCommands = useMemo(
    () =>
      getVisibleCommandList({
        commands: activeCommands,
        search: searchValue,
      }),
    [activeCommands, searchValue]
  );
  const selectedCommand = commandByValue.get(selectedCommandValue);

  const selectBestCommand = useCallback(
    (nextSearchValue: string) => {
      const bestCommand = getBestCommandForSearch(
        activeCommands,
        nextSearchValue
      );
      return bestCommand ? getCommandValue(bestCommand) : "";
    },
    [activeCommands]
  );

  const enterCommandScope = useCallback(
    (command: CommandAction) => {
      if (!command.children || command.children.length === 0) {
        return;
      }

      const firstChild = getBestCommandForSearch(command.children, "");
      pushScope({
        commands: command.children,
        selectedCommandValue: firstChild ? getCommandValue(firstChild) : "",
        title: command.label,
      });
    },
    [pushScope]
  );

  const leaveCommandScope = useCallback(() => {
    if (!canLeaveScope) {
      return false;
    }

    popScope();
    return true;
  }, [canLeaveScope, popScope]);

  const handleSearchValueChange = useCallback(
    (nextSearchValue: string) => {
      setSearch({
        searchValue: nextSearchValue,
        selectedCommandValue: selectBestCommand(nextSearchValue),
      });
    },
    [selectBestCommand, setSearch]
  );

  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        openRoot(selectBestCommand(""));
        return;
      }
      resetCommandStack();
    },
    [openRoot, resetCommandStack, selectBestCommand]
  );

  const moveCommandSelection = useCallback(
    (direction: "ArrowDown" | "ArrowUp") => {
      const nextCommandValue = getNextCommandValue({
        direction,
        selectedCommandValue,
        visibleCommands,
      });
      if (nextCommandValue) {
        setSelection(nextCommandValue);
      }
    },
    [selectedCommandValue, setSelection, visibleCommands]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedCommandIsVisible = visibleCommands.some(
      (command) => getCommandValue(command) === selectedCommandValue
    );
    if (selectedCommandIsVisible || visibleCommands.length === 0) {
      return;
    }

    const bestCommandValue = selectBestCommand(searchValue);
    if (bestCommandValue && bestCommandValue !== selectedCommandValue) {
      setSelection(bestCommandValue);
    }
  }, [
    open,
    searchValue,
    selectBestCommand,
    selectedCommandValue,
    setSelection,
    visibleCommands,
  ]);

  const drillIntoSelectedCommand = useCallback(() => {
    if (!selectedCommand?.children) {
      return false;
    }
    enterCommandScope(selectedCommand);
    return true;
  }, [enterCommandScope, selectedCommand]);

  const handleCommandKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isCommandArrowKey(event.key)) {
        moveCommandSelection(event.key);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowLeft" && leaveCommandScope()) {
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowRight" && drillIntoSelectedCommand()) {
        event.preventDefault();
        return;
      }

      if (event.key === " " && !searchValue && drillIntoSelectedCommand()) {
        event.preventDefault();
        return;
      }

      if (event.key !== "Enter" || !selectedCommand) {
        return;
      }

      event.preventDefault();
      selectedCommand.onSelect();
    },
    [
      drillIntoSelectedCommand,
      leaveCommandScope,
      moveCommandSelection,
      searchValue,
      selectedCommand,
    ]
  );

  useEffect(() => {
    if (!(open && selectedCommandValue)) {
      return;
    }

    document
      .querySelector<HTMLElement>('[data-command-menu-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, selectedCommandValue]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      if (!open && isEditableShortcutTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(!open);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, setMenuOpen]);

  return (
    <DialogRoot onOpenChange={setMenuOpen} open={open}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogContent
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-full max-w-[calc(100%-2rem)] overflow-hidden rounded-none border-4 border-border bg-background p-0 shadow-[8px_8px_0_rgba(0,0,0,0.55),-2px_-2px_0_color-mix(in_oklch,var(--primary)_45%,transparent)] sm:max-w-3xl lg:max-w-5xl"
          data-testid="command-menu"
        >
          <DialogTitle className="sr-only">Command menu</DialogTitle>
          <DialogDescription className="sr-only">
            Search navigation, cell, workspace, and theme commands.
          </DialogDescription>
          <Command
            className="rounded-none bg-card"
            onKeyDownCapture={handleCommandKeyDown}
            shouldFilter={false}
            value={selectedCommandValue}
          >
            <div className="border-border border-b-4 bg-background/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-[0.6rem] text-muted-foreground uppercase tracking-[0.32em]">
                <span>
                  Command Rail{currentScope ? ` / ${currentScope.title}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  {currentScope ? (
                    <span className="border border-primary/40 px-2 py-0.5 text-primary">
                      Left Back
                    </span>
                  ) : null}
                  {selectedCommand?.children ? (
                    <span className="border border-primary/40 px-2 py-0.5 text-primary">
                      {searchValue ? "Right More" : "Right / Space More"}
                    </span>
                  ) : null}
                  <span className="border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                    Ctrl K
                  </span>
                </span>
              </div>
            </div>
            <CommandInput
              className="h-12 rounded-none text-base"
              onInput={(event) =>
                handleSearchValueChange(event.currentTarget.value)
              }
              onValueChange={handleSearchValueChange}
              placeholder="Search commands, cells, workspaces..."
              value={searchValue}
            />
            <CommandList className="h-[min(76vh,42rem)] max-h-[min(76vh,42rem)] scroll-py-3 p-2 [scrollbar-color:hsl(var(--primary))_color-mix(in_oklch,var(--background)_80%,black)] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb:hover]:bg-primary/80 [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-background [&::-webkit-scrollbar-thumb]:bg-primary [&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_55%,black)] [&::-webkit-scrollbar-track]:border-primary/20 [&::-webkit-scrollbar-track]:border-l [&::-webkit-scrollbar-track]:bg-background [&::-webkit-scrollbar]:w-3">
              <CommandEmpty className="py-10 text-center text-muted-foreground text-sm">
                No command found.
              </CommandEmpty>
              {COMMAND_GROUPS.map((group) => {
                const groupCommands = visibleCommands.filter(
                  (command) => command.group === group.id
                );

                if (groupCommands.length === 0) {
                  return null;
                }

                return (
                  <CommandGroup
                    className="pb-2 [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-[0.6rem] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.28em]"
                    heading={group.heading}
                    key={group.id}
                  >
                    {groupCommands.map((command) => (
                      <CommandMenuItem
                        command={command}
                        drillHint={searchValue ? "Right" : "Right / Space"}
                        isSelected={isCommandVisuallySelected({
                          command,
                          selectedCommandValue,
                        })}
                        key={command.id}
                      />
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}

function CommandMenuItem({
  command,
  drillHint,
  isSelected,
}: {
  command: CommandAction;
  drillHint: "Right" | "Right / Space";
  isSelected: boolean;
}) {
  const Icon = command.icon;
  let contextLabel: "Context" | "Current" | undefined;
  if (command.current) {
    contextLabel = "Current";
  } else if (command.contextual) {
    contextLabel = "Context";
  }
  return (
    <CommandItem
      aria-selected={isSelected}
      className={cn(
        "group mb-1 min-h-12 rounded-none border-2 border-transparent px-3 py-2 transition-none data-[selected=true]:border-primary data-[selected=true]:bg-primary/10",
        isSelected && "border-primary bg-primary/10"
      )}
      data-command-menu-selected={isSelected ? "true" : undefined}
      data-testid={`command-menu-item-${command.id}`}
      keywords={[
        command.label,
        command.description,
        ...(command.keywords ?? []),
      ].filter((value): value is string => Boolean(value))}
      onSelect={command.onSelect}
      value={getCommandValue(command)}
    >
      <Icon className="size-4 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground text-sm">
          {command.label}
        </span>
        {command.description ? (
          <span className="block truncate text-muted-foreground text-xs">
            {command.description}
          </span>
        ) : null}
      </span>
      {contextLabel ? (
        <span
          className={cn(
            "px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.22em]",
            command.current
              ? "border border-primary/50 bg-primary/10 text-primary"
              : "text-muted-foreground"
          )}
        >
          {contextLabel}
        </span>
      ) : null}
      {command.children && command.children.length > 0 ? (
        <span className="border border-primary/40 px-2 py-0.5 text-[0.58rem] text-primary uppercase tracking-[0.22em]">
          {drillHint}
        </span>
      ) : null}
      <Search className="size-3 text-muted-foreground opacity-0 transition-none group-data-[selected=true]:opacity-100" />
    </CommandItem>
  );
}
