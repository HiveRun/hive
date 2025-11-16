import { type Static, t } from "elysia";

import type { Construct } from "../schema/constructs";
import {
  type DiffMode,
  getConstructDiffDetails,
  getConstructDiffSummary,
} from "./diff-service";

export const DiffModeSchema = t.Union([
  t.Literal("workspace"),
  t.Literal("branch"),
]);
export const DiffSummaryModeSchema = t.Union([
  t.Literal("full"),
  t.Literal("none"),
]);
export const DiffQuerySchema = t.Object({
  mode: t.Optional(DiffModeSchema),
  files: t.Optional(t.String()),
  summary: t.Optional(DiffSummaryModeSchema),
});

export type ParsedDiffRequest = {
  mode: DiffMode;
  files: string[];
  includeSummary: boolean;
};

export type DiffRequestParseResult =
  | { ok: true; value: ParsedDiffRequest }
  | { ok: false; status: number; message: string };

export function parseDiffRequest(
  construct: Construct,
  query: Static<typeof DiffQuerySchema>
): DiffRequestParseResult {
  const mode = (query.mode ?? "workspace") as DiffMode;
  if (mode === "branch" && !construct.baseCommit) {
    return {
      ok: false,
      status: 400,
      message: "Construct is missing base commit metadata",
    };
  }

  const files = Array.from(
    new Set(
      (query.files ?? "")
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean)
    )
  );

  const includeSummary = query.summary !== "none";

  return {
    ok: true,
    value: {
      mode,
      files,
      includeSummary,
    },
  };
}

export async function buildConstructDiffPayload(
  construct: Construct,
  request: ParsedDiffRequest
) {
  const { mode, files, includeSummary } = request;
  const requestedBaseCommit =
    mode === "branch" ? (construct.baseCommit ?? null) : null;

  const summary = includeSummary
    ? await getConstructDiffSummary({
        workspacePath: construct.workspacePath,
        mode,
        baseCommit: requestedBaseCommit,
      })
    : null;

  const resolvedBaseCommit = summary?.baseCommit ?? requestedBaseCommit ?? null;

  const details = files.length
    ? await getConstructDiffDetails({
        workspacePath: construct.workspacePath,
        mode,
        baseCommit: resolvedBaseCommit,
        files,
        summaryFiles: summary?.files,
      })
    : undefined;

  return {
    mode,
    baseCommit: summary?.baseCommit ?? resolvedBaseCommit,
    headCommit: summary?.headCommit ?? null,
    files: summary?.files ?? [],
    details,
  };
}
