import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CellCreationSheet } from "@/components/cell-creation-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type LinearIssue,
  type LinearTeam,
  linearMutations,
  linearQueries,
} from "@/queries/linear";
import { workspaceQueries } from "@/queries/workspaces";

const linearSearchSchema = z.object({
  workspaceId: z.string().optional(),
});

const LINEAR_IDENTIFIER_PATTERN = /^[A-Z]+-\d+$/i;
const ISSUE_EXPAND_FALLBACK_THRESHOLD = 140;

const getIssueFilterSpec = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      identifier: null,
      raw: "",
    };
  }

  const raw = trimmed.toLowerCase();
  let identifier: string | null = null;

  if (LINEAR_IDENTIFIER_PATTERN.test(trimmed)) {
    identifier = raw;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith("linear.app")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const issueIndex = parts.indexOf("issue");
      const extractedIdentifier =
        issueIndex >= 0 ? parts[issueIndex + 1] : undefined;
      if (extractedIdentifier) {
        identifier = extractedIdentifier.toLowerCase();
      }
    }
  } catch {
    // Plain-text search is still valid.
  }

  return {
    identifier,
    raw,
  };
};

const linearIssueToPrefill = (issue: LinearIssue) => ({
  name: issue.title,
  description: [issue.title, issue.description]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n\n"),
  sourceLabel: issue.identifier,
});

const buildIssueSearchHaystack = (issue: LinearIssue) =>
  [
    issue.identifier,
    issue.title,
    issue.description,
    issue.url,
    issue.assignee?.name,
  ]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n")
    .toLowerCase();

export const Route = createFileRoute("/linear")({
  validateSearch: (search) => linearSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    workspaceId: search.workspaceId,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const data = await queryClient.ensureQueryData(workspaceQueries.list());
    const requestedWorkspace = deps.workspaceId
      ? data.workspaces.find((entry) => entry.id === deps.workspaceId)
      : undefined;
    const activeWorkspace = data.activeWorkspaceId
      ? data.workspaces.find((entry) => entry.id === data.activeWorkspaceId)
      : undefined;
    const workspace =
      requestedWorkspace ?? activeWorkspace ?? data.workspaces[0];

    if (!workspace) {
      throw new Error("No workspaces registered. Add one to continue.");
    }

    await queryClient.ensureQueryData(linearQueries.status(workspace.id));
    return { workspaceId: workspace.id };
  },
  component: LinearRouteComponent,
});

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route coordinates multiple query and mutation states
export function LinearRouteComponent() {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId } = Route.useLoaderData();
  const workspaceListQuery = useQuery(workspaceQueries.list());
  const statusQuery = useQuery(linearQueries.status(workspaceId));
  const teamsQuery = useQuery({
    ...linearQueries.teams(workspaceId),
    enabled: statusQuery.data?.connected ?? false,
  });
  const issuesQuery = useInfiniteQuery({
    queryKey: [
      "linear",
      "issues",
      workspaceId,
      statusQuery.data?.team?.id ?? null,
    ] as const,
    enabled: Boolean(statusQuery.data?.connected && statusQuery.data?.team?.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      linearQueries.issuesPage(workspaceId, pageParam).queryFn(),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    setSelectedTeamId(statusQuery.data?.team?.id ?? "");
  }, [statusQuery.data?.team?.id]);

  const workspaces = workspaceListQuery.data?.workspaces ?? [];
  const issues = issuesQuery.data?.pages.flatMap((page) => page.issues) ?? [];
  const status = statusQuery.data;
  const linkedTeamId = status?.team?.id ?? null;
  const linkedTeamName = status?.team?.name ?? null;
  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId),
    [workspaces, workspaceId]
  );
  const selectedWorkspacePath = selectedWorkspace?.path ?? "Unknown workspace";
  const connected = status?.connected ?? false;
  const linkedTeam = status?.team ?? null;

  const invalidateLinear = async () => {
    await queryClient.invalidateQueries({ queryKey: ["linear"] });
  };

  const saveToken = useMutation({
    mutationFn: linearMutations.saveToken.mutationFn,
    onSuccess: async () => {
      setAccessToken("");
      toast.success("Saved Linear token");
      await invalidateLinear();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const linkTeam = useMutation({
    mutationFn: linearMutations.linkTeam.mutationFn,
    onSuccess: async () => {
      toast.success("Linked Linear team");
      await invalidateLinear();
    },
  });

  const disconnect = useMutation({
    mutationFn: linearMutations.disconnect.mutationFn,
    onSuccess: async () => {
      toast.success("Disconnected Linear");
      await invalidateLinear();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleTeamSelectionChange = (nextTeamId: string) => {
    const previousTeamId = linkedTeamId ?? "";

    setSelectedTeamId(nextTeamId);

    if (nextTeamId === previousTeamId || linkTeam.isPending) {
      return;
    }

    linkTeam.mutate(
      {
        workspaceId,
        teamId: nextTeamId,
      },
      {
        onError: (error: Error) => {
          setSelectedTeamId(previousTeamId);
          toast.error(error.message);
        },
      }
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
        <div className="flex w-full min-w-0 flex-col gap-4 xl:min-h-0 xl:flex-1">
          <LinearHeader />

          <div className="flex min-w-0 flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
            <div className="order-2 min-w-0 xl:order-1 xl:min-h-0 xl:flex-1">
              {connected && linkedTeam ? (
                <IssuesCard
                  hasNextPage={Boolean(issuesQuery.hasNextPage)}
                  isFetchingNextPage={issuesQuery.isFetchingNextPage}
                  isPending={issuesQuery.isPending}
                  isRefreshing={issuesQuery.isFetching}
                  issues={issues}
                  issuesError={
                    issuesQuery.error instanceof Error
                      ? issuesQuery.error.message
                      : null
                  }
                  onLoadMore={() => issuesQuery.fetchNextPage()}
                  onRefresh={() => issuesQuery.refetch()}
                  teamName={linkedTeam.name}
                  workspaceId={workspaceId}
                  workspaceLabel={selectedWorkspace?.label}
                />
              ) : (
                <IssuesPlaceholderCard connected={connected} />
              )}
            </div>

            <aside className="order-1 min-w-0 xl:order-2 xl:min-h-0 xl:w-[19rem] xl:shrink-0">
              <div className="flex min-w-0 flex-col gap-3 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                <WorkspaceCard
                  isConnected={connected}
                  isDisconnecting={disconnect.isPending}
                  onDisconnect={() => disconnect.mutate(workspaceId)}
                  onWorkspaceChange={(value) => {
                    navigate({
                      to: "/linear",
                      search: { workspaceId: value },
                    });
                  }}
                  selectedWorkspacePath={selectedWorkspacePath}
                  workspaceId={workspaceId}
                  workspaces={workspaces}
                />

                {connected ? null : (
                  <TokenSetupCard
                    accessToken={accessToken}
                    isPending={statusQuery.isPending}
                    isSavingToken={saveToken.isPending}
                    onAccessTokenChange={setAccessToken}
                    onSaveToken={() =>
                      saveToken.mutate({
                        workspaceId,
                        accessToken,
                      })
                    }
                    statusError={
                      statusQuery.error instanceof Error
                        ? statusQuery.error.message
                        : null
                    }
                  />
                )}

                {connected ? (
                  <TeamCard
                    currentTeamName={linkedTeamName}
                    isPending={teamsQuery.isPending}
                    isSaving={linkTeam.isPending}
                    onSelectedTeamChange={handleTeamSelectionChange}
                    selectedTeamId={selectedTeamId}
                    teams={teamsQuery.data?.teams ?? []}
                    teamsError={
                      teamsQuery.error instanceof Error
                        ? teamsQuery.error.message
                        : null
                    }
                  />
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

type WorkspaceOption = {
  id: string;
  label: string;
  path: string;
};

const SLIM_PANEL_CARD_CLASS =
  "gap-2 rounded-none border-border/60 bg-card/50 py-2 shadow-none";

const SLIM_PANEL_HEADER_CLASS =
  "gap-1 border-border/40 border-b px-3 py-2 [.border-b]:pb-2";

const SLIM_PANEL_CONTENT_CLASS = "space-y-2 px-3 pb-2";

function LinearHeader() {
  return (
    <div className="border border-border/60 bg-card/20 px-4 py-3 lg:px-5">
      <div className="min-w-0 space-y-1.5 border-primary border-l-4 pl-4">
        <h1 className="font-semibold text-2xl uppercase tracking-[0.2em]">
          Linear
        </h1>
        <p className="max-w-4xl text-muted-foreground text-sm leading-5">
          Save a Linear personal API token for the active Hive workspace, link
          one team, and launch prefilled cells from that team&apos;s issues.
        </p>
      </div>
    </div>
  );
}
function WorkspaceCard({
  isConnected,
  isDisconnecting,
  onDisconnect,
  onWorkspaceChange,
  selectedWorkspacePath,
  workspaceId,
  workspaces,
}: {
  isConnected: boolean;
  isDisconnecting: boolean;
  onDisconnect: () => void;
  onWorkspaceChange: (value: string) => void;
  selectedWorkspacePath: string;
  workspaceId: string;
  workspaces: WorkspaceOption[];
}) {
  return (
    <Card className={SLIM_PANEL_CARD_CLASS}>
      <CardHeader className={SLIM_PANEL_HEADER_CLASS}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm uppercase tracking-[0.18em]">
            Workspace
          </CardTitle>
          {isConnected ? (
            <Button
              disabled={isDisconnecting}
              onClick={onDisconnect}
              size="sm"
              type="button"
              variant="destructive"
            >
              {isDisconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={SLIM_PANEL_CONTENT_CLASS}>
        <Select onValueChange={onWorkspaceChange} value={workspaceId}>
          <SelectTrigger>
            <SelectValue placeholder="Select workspace" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="border border-border/60 bg-background/40 px-2.5 py-2">
          <p className="text-[0.68rem] text-muted-foreground uppercase tracking-[0.24em]">
            Active Path
          </p>
          <p
            className="mt-1.5 truncate font-mono text-[0.68rem] text-foreground/80"
            title={selectedWorkspacePath}
          >
            {selectedWorkspacePath}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamCard({
  currentTeamName,
  isPending,
  isSaving,
  onSelectedTeamChange,
  selectedTeamId,
  teams,
  teamsError,
}: {
  currentTeamName: string | null;
  isPending: boolean;
  isSaving: boolean;
  onSelectedTeamChange: (value: string) => void;
  selectedTeamId: string;
  teams: LinearTeam[];
  teamsError: string | null;
}) {
  let content: React.ReactNode;

  if (isPending) {
    content = (
      <StatusMessage iconSpin message="Loading available Linear teams…" />
    );
  } else if (teamsError) {
    content = <ErrorMessage message={teamsError} />;
  } else {
    content = (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Linked Team
          </span>
          {currentTeamName ? (
            <Badge variant="outline">{currentTeamName}</Badge>
          ) : (
            <Badge variant="secondary">Not linked</Badge>
          )}
        </div>
        <Select
          disabled={isSaving}
          onValueChange={onSelectedTeamChange}
          value={selectedTeamId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a Linear team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.key ? `${team.key} · ${team.name}` : team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSaving ? <StatusMessage iconSpin message="Updating team…" /> : null}
      </div>
    );
  }

  return (
    <Card className={cn(SLIM_PANEL_CARD_CLASS, "xl:min-h-0 xl:flex-1")}>
      <CardHeader className={SLIM_PANEL_HEADER_CLASS}>
        <CardTitle className="text-sm uppercase tracking-[0.18em]">
          Team
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          SLIM_PANEL_CONTENT_CLASS,
          "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
        )}
      >
        {content}
      </CardContent>
    </Card>
  );
}

function TokenSetupCard({
  accessToken,
  isPending,
  isSavingToken,
  onAccessTokenChange,
  onSaveToken,
  statusError,
}: {
  accessToken: string;
  isPending: boolean;
  isSavingToken: boolean;
  onAccessTokenChange: (value: string) => void;
  onSaveToken: () => void;
  statusError: string | null;
}) {
  let body: React.ReactNode;

  if (isPending) {
    body = <StatusMessage iconSpin message="Loading Linear connection…" />;
  } else if (statusError) {
    body = <ErrorMessage message={statusError} />;
  } else {
    body = (
      <>
        <p className="text-muted-foreground text-sm leading-5">
          Paste a Linear personal API token. No `Bearer` prefix.
        </p>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-center">
          <Input
            onChange={(event) => onAccessTokenChange(event.target.value)}
            placeholder="lin_api_..."
            type="password"
            value={accessToken}
          />
          <Button
            disabled={isSavingToken || accessToken.trim().length === 0}
            onClick={onSaveToken}
            type="button"
          >
            {isSavingToken ? "Saving…" : "Save Token"}
          </Button>
          <a
            className="inline-flex items-center gap-2 text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            href="https://linear.app/settings/api"
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-4" />
            Open Linear API settings
          </a>
        </div>
      </>
    );
  }

  return (
    <Card className={cn(SLIM_PANEL_CARD_CLASS, "xl:min-h-0 xl:flex-1")}>
      <CardHeader className={SLIM_PANEL_HEADER_CLASS}>
        <CardTitle className="text-sm uppercase tracking-[0.18em]">
          Token
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          SLIM_PANEL_CONTENT_CLASS,
          "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
        )}
      >
        {body}
      </CardContent>
    </Card>
  );
}

function IssuesPlaceholderCard({ connected }: { connected: boolean }) {
  return (
    <Card className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <CardHeader>
        <CardTitle>Issues</CardTitle>
        <CardDescription>
          Browse issues for the linked Linear team and launch the existing cell
          form prefilled from an issue.
        </CardDescription>
      </CardHeader>
      <CardContent className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="flex min-h-[320px] items-center justify-center border border-border/60 bg-muted/10 px-6 py-10 text-center xl:min-h-0 xl:flex-1">
          <p className="max-w-md text-muted-foreground text-sm leading-6">
            {connected
              ? "Link a Linear team from the right sidebar to start browsing issues here."
              : "Save a Linear personal API token from the right sidebar to load issues here."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function IssuesCard({
  hasNextPage,
  isFetchingNextPage,
  isPending,
  isRefreshing,
  issues,
  issuesError,
  onLoadMore,
  onRefresh,
  teamName,
  workspaceId,
  workspaceLabel,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isRefreshing: boolean;
  issues: LinearIssue[];
  issuesError: string | null;
  onLoadMore: () => void;
  onRefresh: () => void;
  teamName: string;
  workspaceId: string;
  workspaceLabel?: string;
}) {
  const [filterValue, setFilterValue] = useState("");
  const [pendingIssueForCreate, setPendingIssueForCreate] =
    useState<LinearIssue | null>(null);
  const deferredFilterValue = useDeferredValue(filterValue);
  const filterSpec = useMemo(
    () => getIssueFilterSpec(deferredFilterValue),
    [deferredFilterValue]
  );
  const filteredIssues = useMemo(() => {
    if (!filterSpec.raw) {
      return issues;
    }

    return issues.filter((issue) => {
      const issueIdentifier = issue.identifier.toLowerCase();
      const issueUrl = issue.url?.toLowerCase() ?? "";

      if (filterSpec.identifier) {
        return (
          issueIdentifier === filterSpec.identifier ||
          issueUrl === filterSpec.raw ||
          issueUrl.includes(filterSpec.raw)
        );
      }

      const haystack = buildIssueSearchHaystack(issue);
      return haystack.includes(filterSpec.raw);
    });
  }, [filterSpec, issues]);

  let body: React.ReactNode;

  if (isPending) {
    body = <StatusMessage iconSpin message="Loading Linear issues…" />;
  } else if (issuesError) {
    body = <ErrorMessage message={issuesError} />;
  } else if (issues.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">
        No issues found for this team.
      </p>
    );
  } else if (filteredIssues.length === 0) {
    body = (
      <div className="flex min-h-[220px] items-center justify-center border border-border/60 bg-muted/10 px-6 py-10 text-center">
        <p className="max-w-md text-muted-foreground text-sm leading-6">
          No loaded issues match that filter. Try a title, identifier,
          description term, or paste a Linear issue link.
        </p>
      </div>
    );
  } else {
    body = (
      <>
        {pendingIssueForCreate ? (
          <CellCreationSheet
            initialPrefill={linearIssueToPrefill(pendingIssueForCreate)}
            onOpenChange={(open) => {
              if (!open) {
                setPendingIssueForCreate(null);
              }
            }}
            open={pendingIssueForCreate !== null}
            workspaceId={workspaceId}
            workspaceLabel={workspaceLabel}
          />
        ) : null}
        <div className="overflow-hidden border border-border/70 bg-background/50 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <div className="divide-y divide-border/70">
            {filteredIssues.map((issue) => (
              <IssueRow
                issue={issue}
                key={issue.id}
                onCreateCell={() => setPendingIssueForCreate(issue)}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
            {issues.length} issue{issues.length === 1 ? "" : "s"} loaded
          </p>
          <Button
            disabled={!hasNextPage || isFetchingNextPage}
            onClick={onLoadMore}
            size="sm"
            type="button"
            variant="outline"
          >
            {isFetchingNextPage ? "Loading…" : "Load More"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <CardHeader>
        <CardTitle>Issues</CardTitle>
        <CardDescription>
          Browse issues for {teamName} and launch the existing cell form
          prefilled from an issue.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            disabled={isRefreshing}
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCcw
              className={cn("mr-2 size-4", isRefreshing && "animate-spin")}
            />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
        <div className="grid gap-3 border border-border/60 bg-background/35 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="relative">
            <Search
              className="text-muted-foreground"
              size={16}
              style={{
                left: "0.75rem",
                pointerEvents: "none",
                position: "absolute",
                top: "50%",
                transform: "translateY(-50%)",
              }}
            />
            <Input
              className="pl-9"
              onChange={(event) => setFilterValue(event.target.value)}
              placeholder="Filter loaded issues or paste a Linear issue link"
              value={filterValue}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              {filteredIssues.length} of {issues.length} loaded
            </p>
            {filterValue ? (
              <Button
                onClick={() => setFilterValue("")}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X className="mr-2 size-4" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        {body}
      </CardContent>
    </Card>
  );
}

function IssueRow({
  issue,
  onCreateCell,
}: {
  issue: LinearIssue;
  onCreateCell: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDescription = Boolean(issue.description?.trim());
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [canExpand, setCanExpand] = useState(
    Boolean(
      issue.description &&
        (issue.description.trim().length > ISSUE_EXPAND_FALLBACK_THRESHOLD ||
          issue.description.includes("\n"))
    )
  );

  useEffect(() => {
    if (!hasDescription) {
      setCanExpand(false);
      return;
    }

    if (isExpanded) {
      return;
    }

    const element = descriptionRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };

    let frameId: number | null = null;

    const runMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    runMeasure();

    const observer = new ResizeObserver(runMeasure);
    observer.observe(element);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [hasDescription, isExpanded]);

  const showExpandControl = hasDescription && (canExpand || isExpanded);

  return (
    <div className="flex flex-col">
      <div
        className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
        data-linear-issue-row="true"
      >
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{issue.identifier}</Badge>
            {issue.state ? (
              <Badge variant="secondary">{issue.state.name}</Badge>
            ) : null}
            {issue.assignee ? (
              <span className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
                {issue.assignee.name}
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground text-sm">
              {issue.title}
            </p>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              Updated {new Date(issue.updatedAt).toLocaleString()}
            </p>
            {hasDescription ? (
              <p
                className={cn(
                  "text-muted-foreground text-sm leading-5",
                  isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
                )}
                ref={descriptionRef}
              >
                {issue.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:min-w-[10rem] md:flex-col md:items-stretch md:justify-start">
          <Button onClick={onCreateCell} size="sm" type="button">
            Create Cell
          </Button>
          {issue.url ? (
            <Button asChild size="sm" type="button" variant="outline">
              <a href={issue.url} rel="noreferrer" target="_blank">
                <ExternalLink className="mr-2 size-4" />
                Open in Linear
              </a>
            </Button>
          ) : null}
          {showExpandControl ? (
            <Button
              onClick={() => setIsExpanded((current) => !current)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isExpanded ? (
                <ChevronUp className="mr-2 size-4" />
              ) : (
                <ChevronDown className="mr-2 size-4" />
              )}
              {isExpanded ? "Hide Details" : "Show Details"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusMessage({
  message,
  iconSpin = false,
}: {
  message: string;
  iconSpin?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Loader2 className={cn("size-4", iconSpin && "animate-spin")} />
      <span>{message}</span>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
      {message}
    </div>
  );
}
