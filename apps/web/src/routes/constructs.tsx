import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
import { constructQueries } from "@/queries/constructs";
import type { ConstructStatus } from "@/types/construct";

export const Route = createFileRoute("/constructs")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(constructQueries.all()),
  component: ConstructsPage,
});

function ConstructsPage() {
  const { data: constructs } = useSuspenseQuery(constructQueries.all());

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
            Get started by creating your first construct
          </p>
          <Button asChild>
            <Link to="/constructs/new">
              <Plus className="mr-2 size-4" />
              Create Construct
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
    <Badge variant={STATUS_BADGE_VARIANTS[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
