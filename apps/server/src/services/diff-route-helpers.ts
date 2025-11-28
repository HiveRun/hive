import type { Static } from "elysia";

import type { DiffQuerySchema } from "../schema/api";
import type { Cell } from "../schema/cells";
import {
  type DiffMode,
  getCellDiffDetails,
  getCellDiffSummary,
} from "./diff-service";

export type ParsedDiffRequest = {
  mode: DiffMode;
  files: string[];
  includeSummary: boolean;
};

export type DiffRequestParseResult =
  | { ok: true; value: ParsedDiffRequest }
  | { ok: false; status: number; message: string };

export function parseDiffRequest(
  cell: Cell,
  query: Static<typeof DiffQuerySchema>
): DiffRequestParseResult {
  const mode = (query.mode ?? "workspace") as DiffMode;
  if (mode === "branch" && !cell.baseCommit) {
    return {
      ok: false,
      status: 400,
      message: "Cell is missing base commit metadata",
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

export async function buildCellDiffPayload(
  cell: Cell,
  request: ParsedDiffRequest
) {
  const { mode, files, includeSummary } = request;
  const requestedBaseCommit =
    mode === "branch" ? (cell.baseCommit ?? null) : null;

  const summary = includeSummary
    ? await getCellDiffSummary({
        workspacePath: cell.workspacePath,
        mode,
        baseCommit: requestedBaseCommit,
      })
    : null;

  const resolvedBaseCommit = summary?.baseCommit ?? requestedBaseCommit ?? null;

  const details = files.length
    ? await getCellDiffDetails({
        workspacePath: cell.workspacePath,
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
