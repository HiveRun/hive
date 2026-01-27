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
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  WorkspaceBrowseEntry,
  WorkspaceSummary,
} from "@/queries/workspaces";
import { workspaceMutations, workspaceQueries } from "@/queries/workspaces";
import { router } from "@/router";

type WorkspaceManagementSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: "register" | "list" | "all";
  defaultRegisterOpen?: boolean;
};

function useWorkspaceManagement(initialRegisterOpen = false) {
  const [selectedDirectory, setSelectedDirectory] = useState<string>("");
  const [registerOpen, setRegisterOpen] =
    useState<boolean>(initialRegisterOpen);
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined);
  const [browseFilter, setBrowseFilter] = useState<string>("");
  const queryClient = useQueryClient();
  const workspaceListQuery = useQuery(workspaceQueries.list());
  const workspaceBrowseQuery = useQuery({
    ...workspaceQueries.browse(browsePath, browseFilter),
    enabled: registerOpen,
  });
  const workspaceListErrorMessage = resolveWorkspaceListError(
    workspaceListQuery.error
  );
  const invalidateWorkspaceList = () =>
    queryClient.invalidateQueries({
      queryKey: workspaceQueries.list().queryKey,
    });
  const invalidateWorkspaceScopedData = async () => {
    await Promise.all([
      invalidateWorkspaceList(),
      queryClient.invalidateQueries({ queryKey: ["cells"] }),
      queryClient.invalidateQueries({ queryKey: ["templates"] }),
      queryClient.invalidateQueries({ queryKey: ["agent-session"] }),
      queryClient.invalidateQueries({ queryKey: ["agent-messages"] }),
    ]);
    await router.invalidate();
  };

  const registerWorkspace = useMutation({
    mutationFn: workspaceMutations.register.mutationFn,
    onSuccess: (workspace) => {
      toast.success(`Registered ${workspace.label}`);
      setSelectedDirectory("");
      setBrowseFilter("");
      invalidateWorkspaceList();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const activateWorkspace = useMutation({
    mutationFn: workspaceMutations.activate.mutationFn,
    onSuccess: async (workspace) => {
      queryClient.setQueryData(
        workspaceQueries.list().queryKey,
        (prev: unknown) => {
          if (!prev || typeof prev !== "object") {
            return prev;
          }
          const current = prev as {
            workspaces: WorkspaceSummary[];
            activeWorkspaceId: string | null | undefined;
          };
          const existing = current.workspaces.find(
            (item) => item.id === workspace.id
          );
          const nextWorkspaces = existing
            ? current.workspaces
            : [...current.workspaces, workspace];
          return {
            ...current,
            activeWorkspaceId: workspace.id,
            workspaces: nextWorkspaces,
          };
        }
      );
      await invalidateWorkspaceScopedData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeWorkspace = useMutation({
    mutationFn: workspaceMutations.remove.mutationFn,
    onSuccess: async () => {
      toast.success("Workspace removed");
      await invalidateWorkspaceScopedData();
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
    const trimmedPath = selectedDirectory.trim();
    if (!trimmedPath) {
      toast.error("Select a directory to register");
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

  const handleBrowseUp = () => {
    const parentPath = workspaceBrowseQuery.data?.parentPath;
    if (parentPath) {
      setBrowsePath(parentPath);
    }
  };

  const handleDirectorySelect = (dirPath: string) => {
    setSelectedDirectory(dirPath);
  };

  const handleBrowseFilterChange = (value: string) => {
    setBrowseFilter(value);
  };

  const handleDirectoryOpen = (dirPath: string) => {
    setBrowsePath(dirPath);
  };

  const clearBrowsePath = () => setBrowsePath(undefined);

  const browseEntries = workspaceBrowseQuery.data?.directories ?? [];
  const explorerPathLabel = workspaceBrowseQuery.data?.path ?? browsePath ?? "";
  const isBrowseLoading =
    workspaceBrowseQuery.isPending || workspaceBrowseQuery.isRefetching;
  const browseError = workspaceBrowseQuery.error;

  return {
    activeWorkspace,
    activeId,
    browseEntries,
    browseError,
    browseFilter,
    clearBrowsePath,
    explorerPathLabel,
    handleActivate,
    handleBrowseFilterChange,
    handleBrowseUp,
    handleDirectoryOpen,
    handleDirectorySelect,
    handleRegister,
    handleRemove,
    isBrowseLoading,
    isLoading,
    otherWorkspaces,
    parentPath: workspaceBrowseQuery.data?.parentPath,
    refreshBrowse: () => workspaceBrowseQuery.refetch(),
    refreshList: () => workspaceListQuery.refetch(),
    registerOpen,
    registerWorkspace,
    activateWorkspace,
    removeWorkspace,
    selectedDirectory,
    setRegisterOpen,
    sortedWorkspaces,
    workspaceListErrorMessage,
  };
}

function resolveWorkspaceListError(error: unknown): string | undefined {
  if (!error) {
    return;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to load workspaces";
}

type RegisterToggleButtonProps = {
  isOpen: boolean;
  onToggle: () => void;
};

function RegisterToggleButton({ isOpen, onToggle }: RegisterToggleButtonProps) {
  return (
    <div className="relative inline-flex">
      <Button
        className={cn(
          "min-w-[220px] uppercase tracking-[0.2em] transition-opacity",
          isOpen ? "opacity-0" : "opacity-100"
        )}
        onClick={onToggle}
        type="button"
        variant="outline"
      >
        Register new workspace
      </Button>
      <Button
        className={cn(
          "absolute inset-0 min-w-[220px] uppercase tracking-[0.2em] transition-opacity",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onToggle}
        type="button"
        variant="outline"
      >
        Close
      </Button>
    </div>
  );
}

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
}: {
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
}) {
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
                    ? "bg-primary/10 text-foreground"
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
                    <span className="rounded border border-primary/70 px-1 py-0.5 text-[0.55rem] text-primary uppercase tracking-[0.25em]">
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
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  registering: boolean;
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
  onSubmit,
  onClear,
  registering,
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
          Provide an absolute path that contains a hive.config.json.
        </p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <Label>Selected Directory</Label>
          <div className="flex flex-col rounded border border-border bg-background/60 px-3 py-2 text-sm">
            <span className="font-mono text-sm">
              {path || explorerPathLabel || "None selected"}
            </span>
          </div>
        </div>
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

function WorkspaceRowStatic({
  workspace,
  isActive,
}: {
  workspace: WorkspaceSummary;
  isActive: boolean;
}) {
  return (
    <div
      aria-disabled="true"
      className={cn(
        "flex w-full flex-1 items-center gap-3 rounded-sm border px-2 py-1 text-left",
        isActive
          ? "border-primary bg-primary/20 text-primary-foreground"
          : "border-border/60 border-dashed"
      )}
      role="presentation"
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full border-2",
          isActive
            ? "border-primary bg-primary/20 text-primary-foreground"
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
            <span className="ml-2 rounded border border-primary/70 px-1 py-0.5 text-[0.65rem] text-primary uppercase tracking-[0.25em]">
              active
            </span>
          ) : null}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {workspace.path}
        </p>
      </div>
    </div>
  );
}

function WorkspaceRowInteractive({
  workspace,
  isActive,
  activating,
  onActivate,
}: {
  workspace: WorkspaceSummary;
  isActive: boolean;
  activating: boolean;
  onActivate: (id: string) => void;
}) {
  const isClickable = !(isActive || activating);
  const handleActivate = () => {
    if (!isClickable) {
      return;
    }
    onActivate(workspace.id);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isClickable) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(workspace.id);
    }
  };
  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "flex w-full flex-1 items-center gap-3 rounded-sm border border-transparent px-2 py-1 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isActive
          ? "border-primary bg-primary/10"
          : "border-border/60 border-dashed hover:border-primary hover:bg-card/40"
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
            ? "border-primary bg-primary/20 text-primary-foreground"
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
            <span className="ml-2 rounded border border-primary/70 px-1 py-0.5 text-[0.65rem] text-primary uppercase tracking-[0.25em]">
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
  );
}

function WorkspaceRow({
  workspace,
  isActive,
  onActivate,
  onRemove,
  activating,
  removing,
  disableActivation = false,
}: {
  workspace: WorkspaceSummary;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  activating: boolean;
  removing: boolean;
  disableActivation?: boolean;
}) {
  const mainCell = disableActivation ? (
    <WorkspaceRowStatic isActive={isActive} workspace={workspace} />
  ) : (
    <WorkspaceRowInteractive
      activating={activating}
      isActive={isActive}
      onActivate={onActivate}
      workspace={workspace}
    />
  );
  return (
    <div className="space-y-2 border border-border bg-background/80 p-3 text-sm shadow-[2px_2px_0_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3">
        {mainCell}
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
              <AlertDialogTitle>Remove workspace and cells?</AlertDialogTitle>
              <AlertDialogDescription>
                Removing {workspace.label} deletes every cell created in this
                workspace, including their worktrees. This action cannot be
                undone.
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

function WorkspaceListPanel({
  activeWorkspace,
  otherWorkspaces,
  allWorkspaces,
  activeId,
  onActivate,
  onRemove,
  activating,
  removing,
  isLoading,
  errorMessage,
  disableActivation = false,
}: {
  activeWorkspace?: WorkspaceSummary;
  otherWorkspaces: WorkspaceSummary[];
  allWorkspaces: WorkspaceSummary[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  activating: boolean;
  removing: boolean;
  isLoading: boolean;
  errorMessage?: string;
  disableActivation?: boolean;
}) {
  if (isLoading) {
    return (
      <ScrollArea className="min-h-[260px] flex-1 rounded border border-border bg-card/40 p-3">
        <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading workspaces…</span>
        </div>
      </ScrollArea>
    );
  }

  if (errorMessage) {
    return (
      <ScrollArea className="min-h-[260px] flex-1 rounded border border-border bg-card/40 p-3">
        <div
          className="rounded border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm"
          role="alert"
        >
          <p className="font-semibold">Failed to load workspaces</p>
          <p className="mt-1 text-destructive text-xs">{errorMessage}</p>
        </div>
      </ScrollArea>
    );
  }

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
              disableActivation={disableActivation}
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
                  disableActivation={disableActivation}
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

export function WorkspaceManagementSheet({
  open,
  onOpenChange,
  section = "all",
  defaultRegisterOpen = false,
}: WorkspaceManagementSheetProps) {
  const management = useWorkspaceManagement(defaultRegisterOpen);
  useEffect(() => {
    if (open) {
      if (section === "register") {
        management.setRegisterOpen(true);
      } else if (section === "list") {
        management.setRegisterOpen(false);
      }
    }
  }, [open, section, management.setRegisterOpen]);

  const getTitle = () => {
    switch (section) {
      case "register":
        return "Register New Workspace";
      case "list":
        return "Manage Workspaces";
      default:
        return "Manage Workspaces";
    }
  };

  const getDescription = () => {
    switch (section) {
      case "register":
        return "Add a new project workspace by selecting its directory.";
      case "list":
        return "Switch contexts between registered workspaces without stopping running cells.";
      default:
        return "Keep every project registered once, then switch contexts without stopping running cells.";
    }
  };

  const showWorkspaces = section === "list" || section === "all";
  const showRegister = section === "register" || section === "all";

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full transition-none data-[state=closed]:animate-none data-[state=open]:animate-none data-[state=closed]:duration-150 data-[state=open]:duration-150 sm:max-w-3xl"
        side="left"
      >
        <SheetHeader>
          <SheetTitle>{getTitle()}</SheetTitle>
          <SheetDescription>{getDescription()}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col gap-4">
            {showWorkspaces ? (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
                    Registered Workspaces
                  </h3>
                  {section !== "list" && (
                    <Button
                      aria-label="Refresh"
                      className="border border-border"
                      onClick={management.refreshList}
                      size="icon"
                      variant="ghost"
                    >
                      {management.isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
                <WorkspaceListPanel
                  activating={management.activateWorkspace.isPending}
                  activeId={management.activeId}
                  activeWorkspace={management.activeWorkspace}
                  allWorkspaces={management.sortedWorkspaces}
                  disableActivation={section === "list"}
                  errorMessage={management.workspaceListErrorMessage}
                  isLoading={management.isLoading}
                  onActivate={management.handleActivate}
                  onRemove={management.handleRemove}
                  otherWorkspaces={management.otherWorkspaces}
                  removing={management.removeWorkspace.isPending}
                />
              </div>
            ) : null}

            {showRegister ? (
              <div className="flex flex-col gap-3 rounded border border-border border-dashed bg-card/60 p-4">
                {section === "all" ? (
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
                      Register Workspace
                    </h3>
                    <RegisterToggleButton
                      isOpen={management.registerOpen}
                      onToggle={() =>
                        management.setRegisterOpen((prev) => !prev)
                      }
                    />
                  </div>
                ) : null}

                {section === "register" || management.registerOpen ? (
                  <WorkspaceRegisterForm
                    explorerEntries={management.browseEntries}
                    explorerError={management.browseError}
                    explorerFilter={management.browseFilter}
                    explorerPathLabel={management.explorerPathLabel}
                    isExplorerLoading={management.isBrowseLoading}
                    onClear={() => {
                      management.clearBrowsePath();
                      management.setRegisterOpen(false);
                    }}
                    onExplorerFilterChange={management.handleBrowseFilterChange}
                    onExplorerOpen={management.handleDirectoryOpen}
                    onExplorerRefresh={management.refreshBrowse}
                    onExplorerSelect={management.handleDirectorySelect}
                    onExplorerUp={management.handleBrowseUp}
                    onSubmit={management.handleRegister}
                    parentPath={management.parentPath}
                    path={management.selectedDirectory}
                    registering={management.registerWorkspace.isPending}
                    selectedPath={management.selectedDirectory}
                  />
                ) : null}
                {section === "all" && !management.registerOpen ? (
                  <p className="text-muted-foreground text-sm">
                    Click "Register new workspace" to add another project.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
