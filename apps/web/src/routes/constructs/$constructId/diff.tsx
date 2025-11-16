import { parseDiffFromFile } from "@pierre/precision-diffs";
import { FileDiff as PrecisionFileDiff } from "@pierre/precision-diffs/react";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { z } from "zod";
import { Button } from "@/components/ui/button";
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

const DIRECTORY_INDENT_PX = 12;
const FILE_INDENT_OFFSET_PX = 16;

const DIFF_SORT_OPTIONS = {
  "impact-desc": {
    label: "Impact ↓",
    description: "Most changed first",
  },
  "impact-asc": {
    label: "Impact ↑",
    description: "Least changed first",
  },
  path: {
    label: "Path",
    description: "A → Z",
  },
} as const;

const DEFAULT_SORT_MODE = "impact-desc" as const;

type DiffSortMode = keyof typeof DIFF_SORT_OPTIONS;

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
  const [sortMode, setSortMode] = useState<DiffSortMode>(DEFAULT_SORT_MODE);

  const mode = (search.mode ?? "workspace") as DiffMode;

  const summaryQuery = useSuspenseQuery(
    constructDiffQueries.summary(constructId, mode)
  );
  const summary = summaryQuery.data;

  const constructQuery = useQuery(constructQueries.detail(constructId));
  const branchAvailable = Boolean(constructQuery.data?.baseCommit);

  const filteredFiles = useMemo(() => {
    if (!filter.trim()) {
      return summary.files;
    }
    const query = filter.trim().toLowerCase();
    return summary.files.filter((file) =>
      file.path.toLowerCase().includes(query)
    );
  }, [filter, summary.files]);

  const sortedFiles = useMemo(
    () => sortFiles(filteredFiles, sortMode),
    [filteredFiles, sortMode]
  );

  const selectedFile = search.file ?? sortedFiles[0]?.path ?? null;

  const fileTree = useMemo(
    () => buildFileTree(sortedFiles, sortMode),
    [sortedFiles, sortMode]
  );

  const topLevelDirs = useMemo(() => getTopLevelDirs(fileTree), [fileTree]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const hasInitializedDirs = useRef(false);

  useEffect(() => {
    const filterActive = filter.trim().length > 0;
    const expandedAll = expandAllDirectories(fileTree);

    if (!hasInitializedDirs.current) {
      setExpandedDirs(expandedAll);
      hasInitializedDirs.current = true;
      return;
    }

    if (filterActive) {
      setExpandedDirs(expandedAll);
      return;
    }

    const required = buildRequiredDirectories(topLevelDirs, selectedFile);
    setExpandedDirs((prev) => ensureRequiredDirectories(prev, required));
  }, [fileTree, filter, selectedFile, topLevelDirs]);

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

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

  const hasVisibleFiles = sortedFiles.length > 0;

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
          expandedDirs={expandedDirs}
          filter={filter}
          onFilterChange={setFilter}
          onSelectFile={handleFileSelect}
          onSortModeChange={setSortMode}
          onToggleDir={toggleDirectory}
          selectedFile={selectedFile}
          sortMode={sortMode}
          totalCount={sortedFiles.length}
          tree={fileTree}
        />
        <DiffViewer
          detail={detail}
          detailPending={detailQuery.isPending}
          hasVisibleFiles={hasVisibleFiles}
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
  tree: FileTreeNode[];
  totalCount: number;
  filter: string;
  selectedFile: string | null;
  expandedDirs: Set<string>;
  sortMode: DiffSortMode;
  onFilterChange: (value: string) => void;
  onSelectFile: (path: string) => void;
  onSortModeChange: (mode: DiffSortMode) => void;
  onToggleDir: (path: string) => void;
};

function FileSidebar({
  tree,
  totalCount,
  filter,
  selectedFile,
  expandedDirs,
  sortMode,
  onFilterChange,
  onSelectFile,
  onSortModeChange,
  onToggleDir,
}: FileSidebarProps) {
  return (
    <aside className="flex w-full max-w-xs flex-col gap-3 border border-[#1f1f1a] bg-[#080808] p-3">
      <Input
        className="border-[#1f1f1a] bg-[#040404] text-[#d7d9cf]"
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder="Filter files"
        value={filter}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[#6f7169] text-[11px] uppercase tracking-[0.2em]">
          Files ({totalCount})
        </div>
        <Select
          onValueChange={(value) => onSortModeChange(value as DiffSortMode)}
          value={sortMode}
        >
          <SelectTrigger className="h-8 border-[#1f1f1a] bg-[#040404] text-[#d7d9cf]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent className="border-[#1f1f1a] bg-[#050505] text-[#d7d9cf]">
            {Object.entries(DIFF_SORT_OPTIONS).map(([value, option]) => (
              <SelectItem key={value} value={value}>
                <span className="flex flex-col">
                  <span className="text-xs uppercase tracking-[0.2em]">
                    {option.label}
                  </span>
                  <span className="text-[#8b8d85] text-[10px]">
                    {option.description}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 overflow-auto pr-1">
        {tree.length === 0 ? (
          <p className="text-[#7b7d75] text-xs">No files match filter.</p>
        ) : (
          <FileTreeList
            expandedDirs={expandedDirs}
            nodes={tree}
            onSelectFile={onSelectFile}
            onToggleDir={onToggleDir}
            selectedFile={selectedFile}
          />
        )}
      </div>
    </aside>
  );
}

function FileTreeList({
  nodes,
  expandedDirs,
  onToggleDir,
  onSelectFile,
  selectedFile,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  depth?: number;
}) {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-1">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirectoryNode
            depth={depth}
            expandedDirs={expandedDirs}
            key={node.path}
            node={node}
            onSelectFile={onSelectFile}
            onToggleDir={onToggleDir}
            selectedFile={selectedFile}
          />
        ) : (
          <FileNode
            depth={depth}
            key={node.path}
            node={node}
            onSelectFile={onSelectFile}
            selectedFile={selectedFile}
          />
        )
      )}
    </ul>
  );
}

type DirectoryNodeProps = {
  node: Extract<FileTreeNode, { type: "dir" }>;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
};

function DirectoryNode({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onSelectFile,
  selectedFile,
}: DirectoryNodeProps) {
  const isExpanded = expandedDirs.has(node.path);
  const DirectoryIcon = isExpanded ? FolderOpen : Folder;
  const paddingLeft = depth * DIRECTORY_INDENT_PX;

  return (
    <li>
      <button
        className={cn(
          "flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1 text-left text-xs uppercase tracking-[0.25em]",
          "text-[#a1a399] hover:border-[#292926] hover:bg-[#0b0b0a]"
        )}
        onClick={() => onToggleDir(node.path)}
        style={{ paddingLeft }}
        type="button"
      >
        {isExpanded ? (
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
        ) : (
          <ChevronRight aria-hidden="true" className="h-3 w-3" />
        )}
        <DirectoryIcon
          aria-hidden="true"
          className="h-3.5 w-3.5 text-[#5a7c5a]"
        />
        <span className="text-[#d2d4cb]">{node.name}</span>
        <span className="ml-auto text-[#6f7169] text-[10px] tracking-[0.2em]">
          {node.fileCount} {node.fileCount === 1 ? "file" : "files"}
        </span>
      </button>
      {isExpanded && node.children.length > 0 ? (
        <FileTreeList
          depth={depth + 1}
          expandedDirs={expandedDirs}
          nodes={node.children}
          onSelectFile={onSelectFile}
          onToggleDir={onToggleDir}
          selectedFile={selectedFile}
        />
      ) : null}
    </li>
  );
}

type FileNodeProps = {
  node: Extract<FileTreeNode, { type: "file" }>;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
};

function FileNode({ node, depth, onSelectFile, selectedFile }: FileNodeProps) {
  const paddingLeft = depth * DIRECTORY_INDENT_PX;

  return (
    <li>
      <button
        className={cn(
          "w-full cursor-pointer border border-transparent px-2 py-2 text-left text-xs",
          selectedFile === node.path
            ? "border-[#3b3c33] bg-[#11110f]"
            : "hover:border-[#292926] hover:bg-[#0b0b0a]"
        )}
        onClick={() => onSelectFile(node.path)}
        style={{ paddingLeft: paddingLeft + FILE_INDENT_OFFSET_PX }}
        type="button"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileText
              aria-hidden="true"
              className="h-3.5 w-3.5 text-[#b3b5ab]"
            />
            <div className="flex min-w-0 flex-col">
              <span className="break-words text-[#f3f4ed]">{node.name}</span>
              <span className="text-[#808279] text-[10px] uppercase tracking-[0.25em]">
                {node.summary.status}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-[#8f9189] text-[11px]">
            +{node.summary.additions} / -{node.summary.deletions}
          </div>
        </div>
      </button>
    </li>
  );
}

type FileTreeNode =
  | {
      type: "dir";
      name: string;
      path: string;
      children: FileTreeNode[];
      fileCount: number;
      impact: number;
    }
  | {
      type: "file";
      name: string;
      path: string;
      summary: DiffFileSummary;
      impact: number;
    };

type DiffViewerProps = {
  detail: DiffFileDetail | null;
  detailPending: boolean;
  hasVisibleFiles: boolean;
  selectedFile: string | null;
};

function DiffViewer({
  detail,
  detailPending,
  hasVisibleFiles,
  selectedFile,
}: DiffViewerProps) {
  const renderState = () => {
    if (!hasVisibleFiles) {
      return <StatusMessage>No files match the current filters.</StatusMessage>;
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

function StatusMessage({ children }: { children: ReactNode }) {
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
  children: ReactNode;
  testId: string;
}) => (
  <div
    className="flex min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-sm border border-[#1a1a17] bg-[#090909]"
    data-testid={testId}
  >
    <div className="w-full">{children}</div>
  </div>
);

function DiffPreview({
  detail,
  variant = "standalone",
}: {
  detail: DiffFileDetail;
  variant?: "standalone" | "stacked";
}) {
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

  const content = (() => {
    if (semanticDiff) {
      return (
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
      );
    }

    if (detail.patch) {
      return (
        <pre className="whitespace-pre-wrap p-3 font-mono text-[#d9dbd2] text-xs leading-relaxed">
          {detail.patch}
        </pre>
      );
    }

    return null;
  })();

  if (!content) {
    return <StatusMessage>No diff data available.</StatusMessage>;
  }

  if (variant === "stacked") {
    return (
      <div className="rounded-sm border border-[#1a1a17] bg-[#090909]">
        <div className="w-full overflow-x-auto">{content}</div>
      </div>
    );
  }

  const testId = semanticDiff ? "diff-semantic-view" : "diff-patch-view";

  return <DiffScrollContainer testId={testId}>{content}</DiffScrollContainer>;
}

function sortFiles(
  files: DiffFileSummary[],
  sortMode: DiffSortMode
): DiffFileSummary[] {
  if (sortMode === "path") {
    return [...files].sort((a, b) => a.path.localeCompare(b.path));
  }

  const impactDirection = sortMode === "impact-asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    const diff = (getFileImpact(a) - getFileImpact(b)) * impactDirection;
    if (diff !== 0) {
      return diff;
    }
    return a.path.localeCompare(b.path);
  });
}

function getFileImpact(file: DiffFileSummary): number {
  return file.additions + file.deletions;
}

function buildFileTree(
  files: DiffFileSummary[],
  sortMode: DiffSortMode
): FileTreeNode[] {
  type InternalNode =
    | {
        type: "dir";
        name: string;
        path: string;
        children: Map<string, InternalNode>;
      }
    | {
        type: "file";
        name: string;
        path: string;
        summary: DiffFileSummary;
      };

  const root: Map<string, InternalNode> = new Map();

  for (const file of files) {
    const parts = file.path.split("/");
    let cursor = root;
    let pathSoFar = "";
    parts.forEach((part, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isLeaf = index === parts.length - 1;

      if (isLeaf) {
        cursor.set(part, {
          type: "file",
          name: part,
          path: file.path,
          summary: file,
        });
        return;
      }

      const existing = cursor.get(part);
      if (!existing || existing.type === "file") {
        const dirNode: InternalNode = {
          type: "dir",
          name: part,
          path: pathSoFar,
          children: new Map(),
        };
        cursor.set(part, dirNode);
        cursor = dirNode.children;
        return;
      }

      cursor = existing.children;
    });
  }

  const compareNodes = createNodeComparator(sortMode);

  const normalize = (map: Map<string, InternalNode>): FileTreeNode[] =>
    Array.from(map.values())
      .map<FileTreeNode>((node) => {
        if (node.type === "dir") {
          const children = normalize(node.children);
          const impact = children.reduce(
            (count, child) => count + child.impact,
            0
          );
          const fileCount = children.reduce(
            (count, child) =>
              count + (child.type === "dir" ? child.fileCount : 1),
            0
          );
          return {
            type: "dir",
            name: node.name,
            path: node.path,
            children,
            fileCount,
            impact,
          };
        }
        return {
          ...node,
          impact: getFileImpact(node.summary),
        };
      })
      .sort(compareNodes);

  return normalize(root);
}

function createNodeComparator(sortMode: DiffSortMode) {
  if (sortMode === "path") {
    return (a: FileTreeNode, b: FileTreeNode) => {
      if (a.type === b.type) {
        return a.path.localeCompare(b.path);
      }
      return a.type === "dir" ? -1 : 1;
    };
  }

  const impactDirection = sortMode === "impact-asc" ? 1 : -1;
  return (a: FileTreeNode, b: FileTreeNode) => {
    const diff = (a.impact - b.impact) * impactDirection;
    if (diff !== 0) {
      return diff;
    }
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === "dir" ? -1 : 1;
  };
}

function getTopLevelDirs(tree: FileTreeNode[]): string[] {
  const dirs: string[] = [];
  for (const node of tree) {
    if (node.type === "dir") {
      dirs.push(node.path);
    }
  }
  return dirs;
}

function expandAllDirectories(tree: FileTreeNode[]): Set<string> {
  const allDirs = new Set<string>();
  collectDirectoryPaths(tree, allDirs);
  return allDirs;
}

function buildRequiredDirectories(
  topLevelDirs: string[],
  selectedFile: string | null
): Set<string> {
  const required = new Set<string>(topLevelDirs);
  if (selectedFile) {
    for (const dir of gatherAncestorPaths(selectedFile)) {
      required.add(dir);
    }
  }
  return required;
}

function ensureRequiredDirectories(
  current: Set<string>,
  required: Set<string>
): Set<string> {
  let changed = false;
  const next = new Set(current);
  for (const dir of required) {
    if (!next.has(dir)) {
      next.add(dir);
      changed = true;
    }
  }
  return changed ? next : current;
}

function collectDirectoryPaths(nodes: FileTreeNode[], target: Set<string>) {
  for (const node of nodes) {
    if (node.type === "dir") {
      target.add(node.path);
      collectDirectoryPaths(node.children, target);
    }
  }
}

function gatherAncestorPaths(filePath: string): string[] {
  const parts = filePath.split("/");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}
