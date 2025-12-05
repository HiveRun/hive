import type { ReactNode } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentMessage, AgentMessagePart } from "@/queries/agents";

const LEADING_WHITESPACE = /^\s+/;

const ASSISTANT_THEME = {
  container: "border border-primary/40 bg-primary/10 text-foreground",
  label: "text-xs font-semibold uppercase tracking-[0.2em] text-primary",
  content: "text-foreground",
  placeholder: "text-muted-foreground",
};

const USER_THEME = {
  container: "border border-border bg-muted text-foreground",
  label:
    "text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground",
  content: "text-foreground",
  placeholder: "text-muted-foreground",
};

const MILLISECONDS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;
const PATH_INLINE_LIMIT = 48;
const PATH_START_SLICE = 24;
const PATH_END_SLICE = 18;
const DIFF_HEADER_SLICE_OFFSET = 4;
const DIFF_PATH_PREFIX_PATTERN = /^[ab]\//;

type ChatMessage = AgentMessage & {
  interruptionReason?: string | null;
};

export type TracePreferences = {
  showReasoning: boolean;
  showToolRuns: boolean;
  showDiffs: boolean;
};

type MessageBubbleProps = {
  message: ChatMessage;
  tracePreferences: TracePreferences;
};

export function MessageBubble({
  message,
  tracePreferences,
}: MessageBubbleProps) {
  const createdAt = formatTimestamp(message.createdAt);
  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.state === "streaming";
  const trimmedContent = trimMessageContent(message.content ?? null);
  const hasContent = trimmedContent.length > 0;
  const isInterrupted =
    message.role === "user" && Boolean(message.interruptionReason);
  const interruptionStyles = getInterruptionStyles(isInterrupted);

  const theme = isAssistant ? ASSISTANT_THEME : USER_THEME;
  const labelText = isAssistant ? "Agent" : "You";
  const containerClass = cn(
    "px-2 py-1.5 text-sm transition-colors",
    theme.container,
    interruptionStyles?.container
  );
  const labelClass = cn(
    "flex items-center justify-between text-[10px] uppercase tracking-[0.2em]",
    theme.label,
    interruptionStyles?.label
  );
  const placeholderText = isStreaming
    ? "Agent is responding…"
    : (message.errorMessage ?? "No text content");
  const placeholderClass = cn(
    isStreaming
      ? `animate-pulse ${theme.placeholder}`
      : `${theme.placeholder} italic`,
    !isStreaming && message.errorMessage && "text-destructive not-italic"
  );
  const interruptionText = message.interruptionReason
    ? message.interruptionReason.toUpperCase()
    : null;

  const traceBlocks = buildTraceBlocks(message, tracePreferences);

  return (
    <div className={containerClass}>
      <div className={labelClass}>
        <span>{labelText}</span>
        <div className="flex items-center gap-2">
          {interruptionStyles ? (
            <span className={interruptionStyles.badge}>Interrupted</span>
          ) : null}
          <span>{createdAt}</span>
        </div>
      </div>
      <div className="mt-1 leading-relaxed">
        {hasContent ? (
          <p className={`whitespace-pre-wrap ${theme.content}`}>
            {trimmedContent}
          </p>
        ) : (
          <p className={placeholderClass} style={{ minHeight: "1.2rem" }}>
            {placeholderText}
          </p>
        )}
      </div>
      {traceBlocks.length ? (
        <div className="mt-2 space-y-2">{traceBlocks}</div>
      ) : null}
      {interruptionStyles ? (
        <p className={interruptionStyles.reason}>
          {interruptionText ?? message.interruptionReason}
        </p>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function trimMessageContent(content: string | null): string {
  if (!content) {
    return "";
  }
  return content.replace(LEADING_WHITESPACE, "");
}

function getInterruptionStyles(isInterrupted: boolean) {
  if (!isInterrupted) {
    return null;
  }
  return {
    container:
      "border-destructive/80 border-dashed bg-destructive/10 text-destructive",
    label: "text-destructive",
    badge:
      "rounded border border-destructive bg-destructive/20 px-2 py-0.5 font-semibold text-[9px] text-destructive uppercase tracking-[0.3em]",
    reason: "mt-2 text-[11px] text-destructive uppercase tracking-[0.3em]",
  } as const;
}

function buildTraceBlocks(
  message: ChatMessage,
  tracePreferences: TracePreferences
): ReactNode[] {
  const traces: ReactNode[] = [];
  if (tracePreferences.showReasoning) {
    traces.push(...collectReasoningTraces(message));
  }
  if (tracePreferences.showToolRuns) {
    traces.push(...collectToolTraces(message, tracePreferences.showDiffs));
  }
  if (tracePreferences.showDiffs) {
    traces.push(...collectDiffTraces(message));
  }
  return traces;
}

function collectReasoningTraces(message: ChatMessage): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const part of message.parts) {
    if (!isReasoningPart(part)) {
      continue;
    }
    nodes.push(
      <ReasoningTrace key={`${message.id}-reasoning-${part.id}`} part={part} />
    );
  }
  return nodes;
}

function collectToolTraces(
  message: ChatMessage,
  showDiffDetails: boolean
): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const part of message.parts) {
    if (!isToolPart(part)) {
      continue;
    }
    nodes.push(
      <ToolTrace
        key={`${message.id}-tool-${part.id}`}
        part={part}
        showDiffDetails={showDiffDetails}
      />
    );
  }
  return nodes;
}

function collectDiffTraces(message: ChatMessage): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const part of message.parts) {
    if (!isPatchPart(part)) {
      continue;
    }
    nodes.push(<DiffTrace key={`${message.id}-diff-${part.id}`} part={part} />);
  }
  return nodes;
}

type AgentReasoningPart = AgentMessagePart & {
  type: "reasoning";
  text?: string;
};

type ToolState = {
  status?: string;
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  metadata?: Record<string, unknown>;
  time?: {
    start?: number;
    end?: number;
  };
};

type AgentToolPart = AgentMessagePart & {
  type: "tool";
  tool?: string;
  state?: ToolState;
};

type AgentPatchPart = AgentMessagePart & {
  type: "patch";
  files?: string[];
};

function isReasoningPart(part: AgentMessagePart): part is AgentReasoningPart {
  return part.type === "reasoning";
}

function isToolPart(part: AgentMessagePart): part is AgentToolPart {
  return part.type === "tool";
}

function isPatchPart(part: AgentMessagePart): part is AgentPatchPart {
  return part.type === "patch";
}

type TraceBadge = {
  id: string;
  label: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
  className?: string;
};

type TraceCardProps = {
  label: string;
  summary?: ReactNode;
  badges?: TraceBadge[];
  defaultOpen?: boolean;
  children?: ReactNode;
};

function TraceCard({
  label,
  summary,
  badges,
  defaultOpen = false,
  children,
}: TraceCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasDetails = Boolean(children);

  return (
    <div className="rounded border border-border/60 bg-background/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            {label}
          </p>
          {summary ? (
            <div className="text-foreground text-sm">{summary}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {badges?.map((badge) => (
            <Badge
              className={badge.className}
              key={badge.id}
              variant={badge.variant ?? "secondary"}
            >
              {badge.label}
            </Badge>
          ))}
          {hasDetails ? (
            <Button
              aria-expanded={isOpen}
              className="h-7 px-2 text-[10px] uppercase tracking-[0.3em]"
              onClick={() => setIsOpen((previous) => !previous)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isOpen ? "Hide" : "Expand"}
            </Button>
          ) : null}
        </div>
      </div>
      {hasDetails && isOpen ? (
        <div className="mt-2 border-border/40 border-t pt-2 text-foreground text-sm leading-relaxed">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type ReasoningTraceProps = {
  part: AgentReasoningPart;
};

function ReasoningTrace({ part }: ReasoningTraceProps) {
  const text = (part.text ?? "").trim();
  if (!text) {
    return null;
  }

  return (
    <TraceCard label="Reasoning" summary={summarizeSnippet(text)}>
      <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
        {text}
      </p>
    </TraceCard>
  );
}

type ToolTraceProps = {
  part: AgentToolPart;
  showDiffDetails: boolean;
};

function ToolTrace({ part, showDiffDetails }: ToolTraceProps) {
  const state = part.state;
  const toolLabel = formatToolLabel(part.tool);
  const inputTarget = formatPath(extractToolTarget(state));
  const statusLabel = formatStatus(state?.status);
  const titleText = state?.title?.trim() ? state.title.trim() : null;
  const summary =
    [inputTarget ?? titleText, statusLabel].filter(Boolean).join(" • ") ||
    statusLabel ||
    inputTarget ||
    titleText ||
    toolLabel;

  const badges: TraceBadge[] = [];
  const duration = formatDurationRange(state?.time);
  if (duration) {
    badges.push({
      id: `${part.id}-duration`,
      label: duration,
      variant: "outline",
    });
  }

  const diffInfo = showDiffDetails ? extractDiffInfo(part) : null;
  if (diffInfo && (diffInfo.additions > 0 || diffInfo.deletions > 0)) {
    badges.push(
      {
        id: `${part.id}-additions`,
        label: `+${diffInfo.additions}`,
        variant: "secondary",
        className: "text-emerald-500",
      },
      {
        id: `${part.id}-deletions`,
        label: `-${diffInfo.deletions}`,
        variant: "destructive",
      }
    );
  }

  const detailSections: ReactNode[] = [];

  if (diffInfo?.diffText) {
    detailSections.push(
      <TraceDetailSection key="diff" title="Diff">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-muted-foreground text-xs leading-snug">
          {diffInfo.diffText}
        </pre>
      </TraceDetailSection>
    );
  }

  const inputText = formatJSONObject(state?.input);
  if (inputText) {
    detailSections.push(
      <TraceDetailSection key="input" title="Input">
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-2 font-mono text-muted-foreground text-xs leading-snug">
          {inputText}
        </pre>
      </TraceDetailSection>
    );
  }

  const outputText = extractToolOutput(state);
  if (outputText) {
    detailSections.push(
      <TraceDetailSection key="output" title="Output">
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-2 font-mono text-muted-foreground text-xs leading-snug">
          {outputText}
        </pre>
      </TraceDetailSection>
    );
  }

  const errorText = extractToolError(state);
  if (errorText) {
    detailSections.push(
      <TraceDetailSection key="error" title="Error">
        <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-2 font-mono text-destructive text-xs leading-snug">
          {errorText}
        </pre>
      </TraceDetailSection>
    );
  }

  const detailContent =
    detailSections.length > 0 ? (
      <div className="space-y-3">{detailSections}</div>
    ) : undefined;

  return (
    <TraceCard
      badges={badges.length ? badges : undefined}
      label={`Tool · ${toolLabel}`}
      summary={summary}
    >
      {detailContent}
    </TraceCard>
  );
}

type DiffTraceProps = {
  part: AgentPatchPart;
};

function DiffTrace({ part }: DiffTraceProps) {
  const diffInfo = extractDiffInfo(part);
  if (!diffInfo) {
    return null;
  }

  const badges: TraceBadge[] = [
    {
      id: `${part.id}-diff-add`,
      label: `+${diffInfo.additions}`,
      variant: "secondary",
      className: "text-emerald-500",
    },
    {
      id: `${part.id}-diff-del`,
      label: `-${diffInfo.deletions}`,
      variant: "destructive",
    },
  ];

  const detailContent = diffInfo.diffText ? (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-muted-foreground text-xs leading-snug">
      {diffInfo.diffText}
    </pre>
  ) : undefined;

  return (
    <TraceCard
      badges={badges}
      label="Diff"
      summary={formatDiffSummaryLabel(diffInfo.files)}
    >
      {detailContent}
    </TraceCard>
  );
}

type TraceDetailSectionProps = {
  title: string;
  children: ReactNode;
};

function TraceDetailSection({ title, children }: TraceDetailSectionProps) {
  return (
    <div>
      <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
        {title}
      </p>
      <div className="mt-1 rounded border border-border/40 bg-background/70 p-2 text-foreground text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function summarizeSnippet(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatToolLabel(tool?: string) {
  if (!tool) {
    return "Tool";
  }
  const normalized = tool.replace(/[-_]+/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatStatus(status?: string) {
  if (!status) {
    return null;
  }
  const normalized = status.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDurationRange(time?: { start?: number; end?: number }) {
  if (!(time?.start && time.end) || time.end < time.start) {
    return null;
  }
  const duration = time.end - time.start;
  if (duration < MILLISECONDS_IN_SECOND) {
    return `${duration}ms`;
  }
  const seconds = duration / MILLISECONDS_IN_SECOND;
  if (seconds < SECONDS_IN_MINUTE) {
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  const minutes = seconds / SECONDS_IN_MINUTE;
  return `${minutes.toFixed(1)}m`;
}

function formatPath(value?: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.length <= PATH_INLINE_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, PATH_START_SLICE)}…${normalized.slice(-PATH_END_SLICE)}`;
}

function formatJSONObject(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  try {
    if (Object.keys(value as Record<string, unknown>).length === 0) {
      return null;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function extractToolTarget(state?: ToolState) {
  if (!(state?.input && isRecord(state.input))) {
    return null;
  }
  const candidateKeys = ["filePath", "path", "pattern", "target"] as const;
  for (const key of candidateKeys) {
    const candidate = state.input[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function extractToolOutput(state?: ToolState) {
  if (!state) {
    return null;
  }
  const candidates = [
    state.output,
    getMetadataString(state.metadata, "output"),
    getMetadataString(state.metadata, "stdout"),
    getMetadataString(state.metadata, "preview"),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function extractToolError(state?: ToolState) {
  if (!state) {
    return null;
  }
  if (state.status === "error") {
    const metadataError =
      getMetadataString(state.metadata, "error") ??
      getMetadataString(state.metadata, "message");
    return metadataError ?? state.output ?? null;
  }
  return getMetadataString(state.metadata, "error");
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
) {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type DiffInfo = {
  diffText?: string;
  files: string[];
  additions: number;
  deletions: number;
};

function extractDiffInfo(part: AgentMessagePart): DiffInfo | null {
  const fileList = Array.isArray(part.files)
    ? part.files.filter((file): file is string => typeof file === "string")
    : [];
  const diffText =
    getMetadataString(part.metadata, "diff") ??
    getMetadataString((part.state as ToolState | undefined)?.metadata, "diff");
  if (!diffText && fileList.length === 0) {
    return null;
  }
  const summary = summarizeDiffText(diffText, fileList);
  return {
    diffText: diffText ?? undefined,
    files: summary.files,
    additions: summary.additions,
    deletions: summary.deletions,
  };
}

type DiffSummaryState = {
  additions: number;
  deletions: number;
  files: Set<string>;
};

function summarizeDiffText(
  diffText?: string | null,
  fallbackFiles: string[] = []
) {
  const files = new Set<string>();
  for (const file of fallbackFiles) {
    files.add(cleanDiffPath(file));
  }
  const state: DiffSummaryState = {
    additions: 0,
    deletions: 0,
    files,
  };

  if (diffText) {
    processDiffLines(diffText, state);
  }

  return {
    additions: state.additions,
    deletions: state.deletions,
    files: files.size ? Array.from(files) : fallbackFiles,
  };
}

function processDiffLines(diffText: string, state: DiffSummaryState) {
  const lines = diffText.split("\n");
  for (const line of lines) {
    applyDiffLine(line, state);
  }
}

function applyDiffLine(line: string, state: DiffSummaryState) {
  if (line.startsWith("+++")) {
    addHeaderFile(line, state.files);
    return;
  }
  if (line.startsWith("---")) {
    return;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    state.additions += 1;
    return;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    state.deletions += 1;
  }
}

function addHeaderFile(line: string, files: Set<string>) {
  const candidate = cleanDiffPath(line.slice(DIFF_HEADER_SLICE_OFFSET).trim());
  if (candidate && candidate !== "/dev/null") {
    files.add(candidate);
  }
}

function cleanDiffPath(path: string) {
  return path.replace(DIFF_PATH_PREFIX_PATTERN, "").trim();
}

function formatDiffSummaryLabel(files: string[]) {
  if (files.length === 0) {
    return "Changes";
  }
  if (files.length === 1) {
    return files[0];
  }
  return `${files[0]} (+${files.length - 1} more)`;
}
