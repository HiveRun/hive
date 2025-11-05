// biome-ignore lint/style/useFilenamingConvention: TanStack Router requires the `_index` suffix
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConstructListParams } from "@/queries/constructs";
import { constructQueries } from "@/queries/constructs";
import type { ConstructStatus, ConstructType } from "@/types/construct";

const constructsSearchSchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

type ConstructsSearch = z.infer<typeof constructsSearchSchema>;

const CONSTRUCT_STATUS_FILTERS = [
  "draft",
  "provisioning",
  "active",
  "awaiting_input",
  "reviewing",
  "completed",
  "parked",
  "archived",
  "error",
] as const satisfies readonly ConstructStatus[];

const CONSTRUCT_TYPE_FILTERS = [
  "implementation",
  "planning",
  "manual",
] as const satisfies readonly ConstructType[];

function isConstructStatus(value: string): value is ConstructStatus {
  return (CONSTRUCT_STATUS_FILTERS as readonly string[]).includes(value);
}

function isConstructType(value: string): value is ConstructType {
  return (CONSTRUCT_TYPE_FILTERS as readonly string[]).includes(value);
}

function normalizeSearchParams(search: ConstructsSearch): ConstructListParams {
  const params: ConstructListParams = {};

  if (search.status && isConstructStatus(search.status)) {
    params.status = search.status;
  }

  if (search.type && isConstructType(search.type)) {
    params.type = search.type;
  }

  if (typeof search.limit === "number" && Number.isFinite(search.limit)) {
    params.limit = search.limit;
  }

  if (typeof search.offset === "number" && Number.isFinite(search.offset)) {
    params.offset = search.offset;
  }

  return params;
}

export const Route = createFileRoute("/constructs/_index")({
  validateSearch: constructsSearchSchema,
  component: ConstructsIndexPage,
});

function ConstructsIndexPage() {
  const search = Route.useSearch();
  const queryParams = normalizeSearchParams(search);
  const { data: constructs } = useSuspenseQuery(
    constructQueries.all(queryParams)
  );

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl">Constructs</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your development constructs and agent sessions
          </p>
        </div>
        <Button asChild>
          <Link to="/constructs/new">
            <Plus className="mr-2 size-4" />
            New Construct
          </Link>
        </Button>
      </div>

      {constructs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <h3 className="mb-2 font-medium text-lg">No constructs yet</h3>
          <p className="mb-4 text-muted-foreground text-sm">
            Create a construct to spin up an isolated workspace and agent.
          </p>
          <Button asChild size="lg">
            <Link to="/constructs/new">
              <Plus className="mr-2 size-4" />
              New Construct
            </Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {constructs.map((construct) => (
                <TableRow key={construct.id}>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      params={{ constructId: construct.id }}
                      to="/constructs/$constructId"
                    >
                      {construct.name}
                    </Link>
                    {construct.description && (
                      <p className="text-muted-foreground text-sm">
                        {construct.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{construct.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={construct.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {construct.templateId}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(construct.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        params={{ constructId: construct.id }}
                        to="/constructs/$constructId"
                      >
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const STATUS_BADGE_VARIANTS: Record<
  ConstructStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  provisioning: "outline",
  active: "default",
  awaiting_input: "outline",
  reviewing: "outline",
  completed: "secondary",
  parked: "secondary",
  archived: "secondary",
  error: "destructive",
};

function StatusBadge({ status }: { status: ConstructStatus }) {
  return (
    <Badge className="text-xs" variant={STATUS_BADGE_VARIANTS[status]}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
