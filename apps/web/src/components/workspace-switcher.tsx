import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronRight,
  Circle,
  CircleCheck,
  FolderGit2,
  FolderOpen,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  WorkspaceBrowseEntry,
  WorkspaceSummary,
} from "@/queries/workspaces";
import { workspaceMutations, workspaceQueries } from "@/queries/workspaces";

type WorkspaceSwitcherProps = {
  collapsed: boolean;
};

export function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [path, setPath] = useState("");
  const [isExplorerVisible, setIsExplorerVisible] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined);
  const [browseFilter, setBrowseFilter] = useState<string>("");
  const queryClient = useQueryClient();
  const workspaceListQuery = useQuery(workspaceQueries.list());
  const workspaceBrowseQuery = useQuery({
    ...workspaceQueries.browse(browsePath, browseFilter),
    enabled: isExplorerVisible,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: workspaceQueries.list().queryKey,
    });

  const registerWorkspace = useMutation({
    mutationFn: workspaceMutations.register.mutationFn,
    onSuccess: (workspace) => {
      toast.success(`Registered ${workspace.label}`);
      setPath("");
      setBrowseFilter("");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const activateWorkspace = useMutation({
    mutationFn: workspaceMutations.activate.mutationFn,
    onSuccess: () => {
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeWorkspace = useMutation({
    mutationFn: workspaceMutations.remove.mutationFn,
    onSuccess: () => {
      toast.success("Workspace removed");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const activeWorkspace = useMemo(() => {
    if (!workspaceListQuery.data) {
      return;
    }
    const { workspaces: registryWorkspaces, activeWorkspaceId } =
      workspaceListQuery.data;
    return (
      registryWorkspaces.find(
        (workspace) => workspace.id === activeWorkspaceId
      ) ?? registryWorkspaces[0]
    );
  }, [workspaceListQuery.data]);

  const workspaces = workspaceListQuery.data?.workspaces ?? [];
  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((a, b) => {
        const dateCompare =
          new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return a.label.localeCompare(b.label);
      }),
    [workspaces]
  );
  const activeId = workspaceListQuery.data?.activeWorkspaceId ?? null;
  const otherWorkspaces = useMemo(
    () => sortedWorkspaces.filter((workspace) => workspace.id !== activeId),
    [sortedWorkspaces, activeId]
  );

  const isLoading =
    workspaceListQuery.isPending || workspaceListQuery.isRefetching;

  const handleRegister = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      toast.error("Workspace path is required");
      return;
    }
    const derivedLabel =
      trimmedPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
      trimmedPath;

    registerWorkspace.mutate({
      path: trimmedPath,
      label: derivedLabel,
    });
  };

  const handleActivate = (id: string) => {
    activateWorkspace.mutate({ id });
  };

  const handleRemove = (id: string) => {
    removeWorkspace.mutate({ id });
  };

  const toggleExplorer = () => {
    setIsExplorerVisible((prev) => {
      const next = !prev;
      if (next) {
        setBrowsePath(undefined);
        setBrowseFilter("");
      }
      return next;
    });
  };

  const handleBrowseUp = () => {
    const parentPath = workspaceBrowseQuery.data?.parentPath;
    if (parentPath) {
      setBrowsePath(parentPath);
    }
  };

  const handleDirectorySelect = (dirPath: string) => {
    setPath(dirPath);
  };

  const handleBrowseFilterChange = (value: string) => {
    setBrowseFilter(value);
  };

  const handleDirectoryOpen = (dirPath: string) => {
    setBrowsePath(dirPath);
  };

  const buttonLabel = activeWorkspace
    ? activeWorkspace.label
    : "Register workspace";
  const buttonDescription = activeWorkspace?.path ?? "No workspaces registered";

  const browseEntries = workspaceBrowseQuery.data?.directories ?? [];
  const explorerPathLabel = workspaceBrowseQuery.data?.path ?? browsePath ?? "";
  const isBrowseLoading =
    workspaceBrowseQuery.isPending || workspaceBrowseQuery.isRefetching;
  const browseError = workspaceBrowseQuery.error;

  return (
    <div className="flex flex-col gap-2">
      <small
        className={cn(
          "text-[0.6rem] text-muted-foreground uppercase tracking-[0.28em]",
          collapsed && "hidden"
        )}
      >
        Workspace
      </small>
      <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
        <WorkspaceTriggerSummary
          collapsed={collapsed}
          description={buttonDescription}
          isLoading={isLoading}
          label={buttonLabel}
        />

        <SheetContent
          className="w-full transition-none data-[state=closed]:animate-none data-[state=open]:animate-none data-[state=closed]:duration-150 data-[state=open]:duration-150 sm:max-w-3xl"
          side="left"
        >
          <SheetHeader>
            <SheetTitle>Manage Workspaces</SheetTitle>
            <SheetDescription>
              Keep every project registered once, then switch contexts without
              stopping running constructs.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="grid flex-1 gap-6 lg:grid-cols-[1fr,1fr]">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
                    Registered Workspaces
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      className={cn(
                        "uppercase tracking-[0.2em]",
                        registerOpen ? "border-[#5a7c5a]" : undefined
                      )}
                      onClick={() => setRegisterOpen((prev) => !prev)}
                      type="button"
                      variant="outline"
                    >
                      {registerOpen ? "Close" : "Register"}
                    </Button>
                    <Button
                      aria-label="Refresh"
                      className="border border-border"
                      onClick={() => workspaceListQuery.refetch()}
                      size="icon"
                      variant="ghost"
                    >
                      {workspaceListQuery.isRefetching ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <WorkspaceListPanel
                  activating={activateWorkspace.isPending}
                  activeId={activeId}
                  activeWorkspace={activeWorkspace}
                  allWorkspaces={sortedWorkspaces}
                  onActivate={handleActivate}
                  onRemove={handleRemove}
                  otherWorkspaces={otherWorkspaces}
                  removing={removeWorkspace.isPending}
                />
              </div>
              {registerOpen ? (
                <WorkspaceRegisterForm
                  explorerEntries={browseEntries}
                  explorerError={browseError}
                  explorerFilter={browseFilter}
                  explorerPathLabel={explorerPathLabel}
                  explorerVisible={isExplorerVisible}
                  isExplorerLoading={isBrowseLoading}
                  onClear={() => {
                    setPath("");
                    setBrowseFilter("");
                    setBrowsePath(undefined);
                    setRegisterOpen(false);
                  }}
                  onExplorerFilterChange={handleBrowseFilterChange}
                  onExplorerOpen={handleDirectoryOpen}
                  onExplorerRefresh={() => workspaceBrowseQuery.refetch()}
                  onExplorerSelect={handleDirectorySelect}
                  onExplorerToggle={toggleExplorer}
                  onExplorerUp={handleBrowseUp}
                  onPathChange={setPath}
                  onSubmit={handleRegister}
                  parentPath={workspaceBrowseQuery.data?.parentPath}
                  path={path}
                  registering={registerWorkspace.isPending}
                  selectedPath={path}
                />
              ) : (
                <div className="rounded border border-border border-dashed bg-card/40 p-4 text-muted-foreground text-sm">
                  <p>Need to add another project?</p>
                  <Button
                    className="mt-3"
                    onClick={() => setRegisterOpen(true)}
                    type="button"
                    variant="secondary"
                  >
                    Register new workspace
                  </Button>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

type WorkspaceDirectoryExplorerProps = {
  currentPath: string;
  entries: WorkspaceBrowseEntry[];
  isLoading: boolean;
  error: unknown;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (path: string) => void;
  onOpenDirectory: (path: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  parentPath?: string | null;
  selectedPath: string;
};

function WorkspaceDirectoryExplorer({
  currentPath,
  entries,
  isLoading,
  error,
  filter,
  onFilterChange,
  onSelect,
  onOpenDirectory,
  onUp,
  onRefresh,
  parentPath,
  selectedPath,
}: WorkspaceDirectoryExplorerProps) {
  const errorMessage =
    error && error instanceof Error ? error.message : undefined;

  let content: ReactNode = (
    <div className="flex h-48 items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );

  if (!isLoading) {
    if (errorMessage) {
      content = (
        <div className="p-3 text-destructive text-sm">{errorMessage}</div>
      );
    } else if (entries.length === 0) {
      content = (
        <div className="p-3 text-muted-foreground text-sm">
          No folders found in this directory.
        </div>
      );
    } else {
      content = (
        <div className="flex flex-col divide-y divide-border/40">
          {entries.map((entry) => {
            const isSelected = selectedPath === entry.path;
            return (
              <button
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                  isSelected
                    ? "bg-[#22382a] text-foreground"
                    : "hover:bg-card/40"
                )}
                key={entry.path}
                onClick={() => onSelect(entry.path)}
                type="button"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                  {entry.hasConfig ? (
                    <span className="rounded border border-emerald-400 px-1 py-0.5 text-[0.55rem] text-emerald-300 uppercase tracking-[0.25em]">
                      config
                    </span>
                  ) : null}
                </div>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDirectory(entry.path);
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </button>
            );
          })}
        </div>
      );
    }
  }

  return (
    <div className="space-y-3 rounded border border-border bg-background/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.25em]">
        <span className="truncate text-left">
          {currentPath || "Select a directory"}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={!parentPath || isLoading}
            onClick={onUp}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowUp className="mr-1 size-3.5" /> Up
          </Button>
          <Button
            disabled={isLoading}
            onClick={onRefresh}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-xs"
          onChange={(event) => onFilterChange(event.currentTarget.value)}
          placeholder="Search"
          value={filter}
        />
        <span className="text-[0.65rem] text-muted-foreground">
          {entries.length} {entries.length === 1 ? "folder" : "folders"}
        </span>
      </div>
      <ScrollArea className="h-48 rounded border border-border/60 bg-card/20">
        {content}
      </ScrollArea>
    </div>
  );
}

type WorkspaceRegisterFormProps = {
  path: string;
  onPathChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  registering: boolean;
  explorerVisible: boolean;
  onExplorerToggle: () => void;
  explorerPathLabel: string;
  explorerEntries: WorkspaceBrowseEntry[];
  isExplorerLoading: boolean;
  explorerError: unknown;
  onExplorerSelect: (path: string) => void;
  onExplorerOpen: (path: string) => void;
  onExplorerUp: () => void;
  onExplorerRefresh: () => void;
  explorerFilter: string;
  onExplorerFilterChange: (value: string) => void;
  parentPath?: string | null;
  selectedPath: string;
};

function WorkspaceRegisterForm({
  path,
  onPathChange,
  onSubmit,
  onClear,
  registering,
  explorerVisible,
  onExplorerToggle,
  explorerPathLabel,
  explorerEntries,
  isExplorerLoading,
  explorerError,
  onExplorerSelect,
  onExplorerOpen,
  onExplorerUp,
  onExplorerRefresh,
  explorerFilter,
  onExplorerFilterChange,
  parentPath,
  selectedPath,
}: WorkspaceRegisterFormProps) {
  return (
    <div className="flex flex-col gap-3 rounded border border-border border-dashed bg-card/60 p-4">
      <div>
        <h3 className="font-semibold text-sm uppercase tracking-[0.2em]">
          Register Workspace
        </h3>
        <p className="text-muted-foreground text-sm">
          Provide an absolute path that contains a synthetic.config.ts.
        </p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="workspace-path">Workspace Path</Label>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              id="workspace-path"
              onChange={(event) => onPathChange(event.currentTarget.value)}
              placeholder="/home/user/projects/amazing-app"
              required
              value={path}
            />
            <Button
              aria-label="Browse directories"
              onClick={onExplorerToggle}
              size="icon"
              type="button"
              variant="outline"
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
          {explorerVisible ? (
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {explorerPathLabel || "Select a directory"}
            </p>
          ) : null}
        </div>
        {explorerVisible ? (
          <WorkspaceDirectoryExplorer
            currentPath={explorerPathLabel}
            entries={explorerEntries}
            error={explorerError}
            filter={explorerFilter}
            isLoading={isExplorerLoading}
            onFilterChange={onExplorerFilterChange}
            onOpenDirectory={onExplorerOpen}
            onRefresh={onExplorerRefresh}
            onSelect={onExplorerSelect}
            onUp={onExplorerUp}
            parentPath={parentPath}
            selectedPath={selectedPath}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" disabled={registering} type="submit">
            {registering ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Register workspace"
            )}
          </Button>
          <Button onClick={onClear} type="button" variant="secondary">
            Clear
          </Button>
        </div>
      </form>
    </div>
  );
}

type WorkspaceRowProps = {
  workspace: WorkspaceSummary;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  activating: boolean;
  removing: boolean;
};

function WorkspaceRow({
  workspace,
  isActive,
  onActivate,
  onRemove,
  activating,
  removing,
}: WorkspaceRowProps) {
  const handleActivate = () => {
    if (isActive || activating) {
      return;
    }
    onActivate(workspace.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isActive || activating) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(workspace.id);
    }
  };

  const isClickable = !(isActive || activating);

  return (
    <div className="space-y-2 border border-border bg-background/80 p-3 text-sm shadow-[2px_2px_0_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3">
        <button
          aria-pressed={isActive}
          className={cn(
            "flex w-full flex-1 items-center gap-3 rounded-sm border border-transparent px-2 py-1 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a7c5a]",
            isActive
              ? "border-[#5a7c5a] bg-[#22382a]"
              : "border-border/60 border-dashed hover:border-[#5a7c5a] hover:bg-card/40"
          )}
          disabled={!isClickable}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          type="button"
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border-2",
              isActive
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-border/70 text-muted-foreground"
            )}
          >
            {isActive ? (
              <CircleCheck className="size-3.5" />
            ) : (
              <Circle className="size-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              {workspace.label}
              {isActive ? (
                <span className="ml-2 rounded border border-emerald-400 px-1 py-0.5 text-[0.65rem] text-emerald-300 uppercase tracking-[0.25em]">
                  active
                </span>
              ) : null}
            </p>
            <p className="truncate text-muted-foreground text-xs">
              {workspace.path}
            </p>
            {isActive ? null : (
              <p className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.3em]">
                Tap to activate
              </p>
            )}
          </div>
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={removing} size="sm" variant="destructive">
              {removing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <Trash2 className="mr-2 size-3.5" /> Remove
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove workspace?</AlertDialogTitle>
              <AlertDialogDescription>
                {workspace.label} will be removed from Synthetic. Worktrees and
                constructs will remain on disk.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRemove(workspace.id)}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

type WorkspaceListPanelProps = {
  activeWorkspace?: WorkspaceSummary;
  otherWorkspaces: WorkspaceSummary[];
  allWorkspaces: WorkspaceSummary[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  activating: boolean;
  removing: boolean;
};

function WorkspaceListPanel({
  activeWorkspace,
  otherWorkspaces,
  allWorkspaces,
  activeId,
  onActivate,
  onRemove,
  activating,
  removing,
}: WorkspaceListPanelProps) {
  if (allWorkspaces.length === 0) {
    return (
      <ScrollArea className="min-h-[260px] flex-1 rounded border border-border bg-card/40 p-3">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
          <FolderGit2 className="size-6 opacity-70" />
          <p>No workspaces registered yet.</p>
          <p>Add the current repo path to get started.</p>
        </div>
      </ScrollArea>
    );
  }

  const secondaryWorkspaces = activeWorkspace ? otherWorkspaces : allWorkspaces;

  return (
    <ScrollArea className="min-h-[260px] flex-1 rounded border border-border bg-card/40 p-3">
      <div className="flex flex-col gap-4">
        {activeWorkspace ? (
          <div className="space-y-2">
            <p className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.3em]">
              Active workspace
            </p>
            <WorkspaceRow
              activating={activating}
              isActive
              key={activeWorkspace.id}
              onActivate={onActivate}
              onRemove={onRemove}
              removing={removing}
              workspace={activeWorkspace}
            />
          </div>
        ) : null}

        {secondaryWorkspaces.length ? (
          <div className="space-y-2">
            {activeWorkspace ? (
              <p className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.3em]">
                Other workspaces
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              {secondaryWorkspaces.map((workspace) => (
                <WorkspaceRow
                  activating={activating}
                  isActive={workspace.id === activeId}
                  key={workspace.id}
                  onActivate={onActivate}
                  onRemove={onRemove}
                  removing={removing}
                  workspace={workspace}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground text-sm">
            No other workspaces yet.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

type WorkspaceTriggerSummaryProps = {
  collapsed: boolean;
  isLoading: boolean;
  label: string;
  description: string;
};

function WorkspaceTriggerSummary({
  collapsed,
  isLoading,
  label,
  description,
}: WorkspaceTriggerSummaryProps) {
  if (collapsed) {
    return (
      <SheetTrigger asChild>
        <Button aria-label="Manage workspaces" size="icon" variant="ghost">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FolderGit2 className="size-4" />
          )}
        </Button>
      </SheetTrigger>
    );
  }

  return (
    <SheetTrigger asChild>
      <button
        className="group flex w-full items-center gap-3 rounded-none border-2 border-transparent px-3 py-2 text-left text-muted-foreground uppercase tracking-[0.18em] transition-none hover:border-[#5a7c5a] hover:bg-[#22382a] hover:text-[#f4f7f2]"
        type="button"
      >
        <span className="flex size-8 items-center justify-center rounded-none border border-[#5a7c5a] bg-transparent text-foreground">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FolderGit2 className="size-4" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left normal-case tracking-normal">
          <span className="text-[0.55rem] text-muted-foreground uppercase tracking-[0.32em]">
            Workspace
          </span>
          <span className="truncate font-semibold text-foreground text-sm leading-tight">
            {label}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {description}
          </span>
        </div>
      </button>
    </SheetTrigger>
  );
}
