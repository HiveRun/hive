import type { CellFormInitialPrefill } from "@/components/cell-form";
import type { LinearIssue } from "@/queries/linear";

const isNonEmptyString = (value: string | null | undefined): value is string =>
  Boolean(value && value.length > 0);

export const linearIssueToCellPrefill = (
  issue: LinearIssue
): CellFormInitialPrefill => ({
  name: issue.title,
  description: [
    issue.title,
    issue.description,
    issue.url ? `Linear issue: ${issue.url}` : null,
  ]
    .filter(isNonEmptyString)
    .join("\n\n"),
  sourceLabel: issue.identifier,
});
