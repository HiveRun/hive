import { parseDiffFromFile } from "@pierre/precision-diffs";
import { FileDiff as PrecisionFileDiff } from "@pierre/precision-diffs/react";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type ConstructDiffResponse,
  constructDiffQueries,
  constructQueries,
  type DiffFileDetail,
  type DiffFileSummary,
  type DiffMode,
} from "@/queries/constructs";

const diffSearchSchema = z.object({
  mode: z.enum(["workspace", "branch"]).optional(),
  file: z.string().optional(),
});

type DiffSearch = z.infer<typeof diffSearchSchema>;

const COMMIT_PREVIEW_LENGTH = 8;
const DIFF_MODE_META: Record<
  DiffMode,
  { button: string; description: string }
> = {
  workspace: {
    button: "Uncommitted",
    description: "Uncommitted changes (working tree)",
  },
  branch: {
    button: "All",
    description: "All changes since construct base",
  },
};

export const Route = createFileRoute("/constructs/$constructId/diff")({
  validateSearch: (search) => diffSearchSchema.parse(search),
  loader: async ({ params, context: { queryClient } }) => {
    await queryClient.ensureQueryData(
      constructDiffQueries.summary(params.constructId, "workspace")
    );
    return null;
  },
  component: ConstructDiffRoute,
});

function ConstructDiffRoute() {
  const { constructId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");

  const mode = (search.mode ?? "workspace") as DiffMode;

  const summaryQuery = useSuspenseQuery(
    constructDiffQueries.summary(constructId, mode)
  );
  const summary = summaryQuery.data;

  const constructQuery = useQuery(constructQueries.detail(constructId));
  const branchAvailable = Boolean(constructQuery.data?.baseCommit);

  const files = useMemo(() => {
    if (!filter.trim()) {
      return summary.files;
    }
    const query = filter.trim().toLowerCase();
    return summary.files.filter((file) =>
      file.path.toLowerCase().includes(query)
    );
  }, [filter, summary]);

  const selectedFile = search.file ?? summary.files[0]?.path ?? null;
  const detailQuery = useQuery({
    ...constructDiffQueries.detail(
      constructId,
      mode,
      selectedFile ?? "__none__"
    ),
    enabled: Boolean(selectedFile),
  });
  const detail = selectedFile ? (detailQuery.data ?? null) : null;

  const totals = useMemo(
    () =>
      summary.files.reduce(
        (acc, file) => ({
          additions: acc.additions + file.additions,
          deletions: acc.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [summary]
  );

  const updateSearch = (updater: (prev: DiffSearch) => DiffSearch) => {
    navigate({
      to: "/constructs/$constructId/diff",
      params: { constructId },
      search: updater,
      replace: true,
    });
  };

  const handleModeChange = (nextMode: DiffMode) => {
    if (nextMode === mode) {
      return;
    }
    updateSearch((prev) => ({
      ...prev,
      mode: nextMode,
      file: undefined,
    }));
  };

  const handleFileSelect = (path: string) => {
    if (path === selectedFile) {
      return;
    }
    updateSearch((prev) => ({
      ...prev,
      file: path,
    }));
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["construct-diff", constructId],
    });
  };

  const hasChanges = summary.files.length > 0;

  return (
    <div className="flex h-full flex-col gap-4 rounded-sm border-2 border-[#1f1f1c] bg-[#050505] p-4 text-[#c7c9bf] text-sm">
      <DiffHeader
        branchAvailable={branchAvailable}
        mode={mode}
        onModeChange={handleModeChange}
        onRefresh={handleRefresh}
        summary={summary}
        totals={totals}
      />
      <div className="flex min-h-0 flex-1 gap-4">
        <FileSidebar
          files={files}
          filter={filter}
          onFilterChange={setFilter}
          onSelectFile={handleFileSelect}
          selectedFile={selectedFile}
          totalCount={summary.files.length}
        />
        <DiffViewer
          detail={detail}
          detailPending={detailQuery.isPending}
          hasChanges={hasChanges}
          selectedFile={selectedFile}
        />
      </div>
    </div>
  );
}

type DiffHeaderProps = {
  mode: DiffMode;
  summary: ConstructDiffResponse;
  totals: { additions: number; deletions: number };
  branchAvailable: boolean;
  onModeChange: (mode: DiffMode) => void;
  onRefresh: () => void;
};

function DiffHeader({
  mode,
  summary,
  totals,
  branchAvailable,
  onModeChange,
  onRefresh,
}: DiffHeaderProps) {
  const renderCommitStats = (label: string, value?: string | null) => {
    if (!value) {
      return null;
    }
    return (
      <span>
        {label} · {value.slice(0, COMMIT_PREVIEW_LENGTH)}
      </span>
    );
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-[#1a1a17] border-b pb-3">
      <div className="space-y-1">
        <p className="text-[#73756d] text-xs uppercase tracking-[0.3em]">
          Construct Diff
        </p>
        <div className="flex flex-wrap gap-4 text-[#8e9088] text-[11px] uppercase tracking-[0.2em]">
          <span>Mode · {DIFF_MODE_META[mode].description}</span>
          {renderCommitStats("Base", summary.baseCommit)}
          {renderCommitStats("Head", summary.headCommit)}
          <span>
            Δ · +{totals.additions} / -{totals.deletions}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => onModeChange("workspace")}
          size="sm"
          variant={mode === "workspace" ? "secondary" : "outline"}
        >
          {DIFF_MODE_META.workspace.button}
        </Button>
        <Button
          disabled={!branchAvailable}
          onClick={() => onModeChange("branch")}
          size="sm"
          variant={mode === "branch" ? "secondary" : "outline"}
        >
          {DIFF_MODE_META.branch.button}
        </Button>
        <Button onClick={onRefresh} size="sm" variant="outline">
          Refresh
        </Button>
      </div>
    </header>
  );
}

type FileSidebarProps = {
  files: DiffFileSummary[];
  totalCount: number;
  filter: string;
  selectedFile: string | null;
  onFilterChange: (value: string) => void;
  onSelectFile: (path: string) => void;
};

function FileSidebar({
  files,
  totalCount,
  filter,
  selectedFile,
  onFilterChange,
  onSelectFile,
}: FileSidebarProps) {
  return (
    <aside className="flex w-full max-w-xs flex-col gap-3 border border-[#1a1a17] bg-[#080808] p-3">
      <Input
        className="border-[#1f1f1a] bg-[#040404] text-[#d7d9cf]"
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder="Filter files"
        value={filter}
      />
      <div className="text-[#6f7169] text-[11px] uppercase tracking-[0.2em]">
        Files ({totalCount})
      </div>
      <div className="flex-1 overflow-auto pr-1">
        {files.length === 0 ? (
          <p className="text-[#7b7d75] text-xs">No files match filter.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  className={cn(
                    "w-full cursor-pointer border border-transparent px-2 py-2 text-left text-xs",
                    selectedFile === file.path
                      ? "border-[#3b3c33] bg-[#11110f]"
                      : "hover:border-[#292926] hover:bg-[#0b0b0a]"
                  )}
                  onClick={() => onSelectFile(file.path)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="truncate text-[#f3f4ed]">
                        {file.path}
                      </span>
                      <span className="text-[#808279] text-[10px] uppercase tracking-[0.25em]">
                        {file.status}
                      </span>
                    </div>
                    <div className="shrink-0 text-[#8f9189] text-[11px]">
                      +{file.additions} / -{file.deletions}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

type DiffViewerProps = {
  detail: DiffFileDetail | null;
  detailPending: boolean;
  hasChanges: boolean;
  selectedFile: string | null;
};

function DiffViewer({
  detail,
  detailPending,
  hasChanges,
  selectedFile,
}: DiffViewerProps) {
  const renderState = () => {
    if (!hasChanges) {
      return <StatusMessage>No changes detected for this mode.</StatusMessage>;
    }
    if (!selectedFile) {
      return <StatusMessage>Select a file to view its diff.</StatusMessage>;
    }
    if (detailPending) {
      return <StatusMessage>Loading diff…</StatusMessage>;
    }
    if (detail) {
      return <DiffPreview detail={detail} />;
    }
    return <StatusMessage>Unable to load diff for this file.</StatusMessage>;
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 border border-[#1a1a17] bg-[#060606] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-[#12120f] border-b pb-2">
        <div className="flex flex-col">
          <span className="text-[#6c6e66] text-xs uppercase tracking-[0.3em]">
            {selectedFile || "No file selected"}
          </span>
          {detail ? (
            <span className="text-[#96988f] text-[11px]">
              +{detail.additions} / -{detail.deletions}
            </span>
          ) : null}
        </div>
      </div>

      {renderState()}
    </section>
  );
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[#7f8179] text-sm">
      {children}
    </div>
  );
}

const DiffScrollContainer = ({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId: string;
}) => (
  <div
    className="flex min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-sm border border-[#1a1a17] bg-[#090909]"
    data-testid={testId}
  >
    <div className="w-full">{children}</div>
  </div>
);

function DiffPreview({ detail }: { detail: DiffFileDetail }) {
  const semanticDiff = useMemo(() => {
    if (!(detail.beforeContent || detail.afterContent)) {
      return null;
    }
    try {
      return parseDiffFromFile(
        { name: detail.path, contents: detail.beforeContent ?? "" },
        { name: detail.path, contents: detail.afterContent ?? "" }
      );
    } catch {
      return null;
    }
  }, [detail.afterContent, detail.beforeContent, detail.path]);

  if (semanticDiff) {
    return (
      <DiffScrollContainer testId="diff-semantic-view">
        <PrecisionFileDiff
          className="precision-diff"
          fileDiff={semanticDiff}
          options={{
            theme: "github-dark-default",
            diffStyle: "unified",
            disableFileHeader: true,
            diffIndicators: "bars",
            lineDiffType: "word-alt",
            overflow: "wrap",
          }}
        />
      </DiffScrollContainer>
    );
  }

  if (detail.patch) {
    return (
      <DiffScrollContainer testId="diff-patch-view">
        <pre className="whitespace-pre-wrap p-3 font-mono text-[#d9dbd2] text-xs leading-relaxed">
          {detail.patch}
        </pre>
      </DiffScrollContainer>
    );
  }

  return <StatusMessage>No diff data available.</StatusMessage>;
}
