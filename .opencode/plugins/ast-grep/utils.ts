import type { AnalyzeResult, SgResult } from "./types";

const appendTruncationLines = (lines: string[], result: SgResult): void => {
  if (!result.truncated) {
    return;
  }

  let reason = "search timed out";
  if (result.truncatedReason === "max_matches") {
    reason = `showing first ${result.matches.length} of ${result.totalMatches}`;
  } else if (result.truncatedReason === "max_output_bytes") {
    reason = "output exceeded 1MB limit";
  }

  lines.push(`Results truncated (${reason})\n`);
};

const errorOrEmptyResult = (
  result: SgResult,
  emptyMessage: string
): string | null => {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return emptyMessage;
  }

  return null;
};

const appendMatchLines = (
  lines: string[],
  result: SgResult,
  textForMatch: (match: SgResult["matches"][number]) => string
) => {
  for (const match of result.matches) {
    const loc = `${match.file}:${match.range.start.line + 1}:${match.range.start.column + 1}`;
    lines.push(`${loc}`);
    lines.push(`  ${textForMatch(match)}`);
    lines.push("");
  }
};

export const formatSearchResult = (result: SgResult): string => {
  const readyResult = errorOrEmptyResult(result, "No matches found");
  if (readyResult) {
    return readyResult;
  }

  const lines: string[] = [];

  appendTruncationLines(lines, result);

  lines.push(
    `Found ${result.matches.length} match(es)` +
      (result.truncated ? ` (truncated from ${result.totalMatches})` : "") +
      ":\n"
  );

  appendMatchLines(lines, result, (match) => match.lines.trim());

  return lines.join("\n");
};

export const formatReplaceResult = (
  result: SgResult,
  isDryRun: boolean
): string => {
  const readyResult = errorOrEmptyResult(result, "No matches found to replace");
  if (readyResult) {
    return readyResult;
  }

  const prefix = isDryRun ? "[DRY RUN] " : "";
  const lines: string[] = [];

  appendTruncationLines(lines, result);

  lines.push(`${prefix}${result.matches.length} replacement(s):\n`);

  appendMatchLines(lines, result, (match) => match.text);

  if (isDryRun) {
    lines.push("Use dryRun=false to apply changes");
  }

  return lines.join("\n");
};

export const formatAnalyzeResult = (
  results: AnalyzeResult[],
  extractedMetaVars: boolean
): string => {
  if (results.length === 0) {
    return "No matches found";
  }

  const lines: string[] = [`Found ${results.length} match(es):\n`];

  for (const result of results) {
    const loc = `L${result.range.start.line + 1}:${result.range.start.column + 1}`;
    lines.push(`[${loc}] (${result.kind})`);
    lines.push(`  ${result.text}`);

    if (extractedMetaVars && result.metaVariables.length > 0) {
      lines.push("  Meta-variables:");
      for (const mv of result.metaVariables) {
        lines.push(`    $${mv.name} = "${mv.text}" (${mv.kind})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
};

export const formatTransformResult = (
  _original: string,
  transformed: string,
  editCount: number
): string => {
  if (editCount === 0) {
    return "No matches found to transform";
  }

  return `Transformed (${editCount} edit(s)):\n\n${transformed}`;
};
