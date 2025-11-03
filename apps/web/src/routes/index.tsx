import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { constructQueries } from "@/queries/constructs";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(constructQueries.all({ limit: 5 })),
  component: HomeComponent,
});

function HomeComponent() {
  const { data: recentConstructs } = useSuspenseQuery(
    constructQueries.all({ limit: 5 })
  );

  const stats = {
    total: recentConstructs.length,
    active: recentConstructs.filter((c) => c.status === "active").length,
    draft: recentConstructs.filter((c) => c.status === "draft").length,
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="font-bold text-4xl">Synthetic</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          AI-powered development constructs and orchestration
        </p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-muted-foreground text-sm">
              Total Constructs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-3xl">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-muted-foreground text-sm">
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-3xl">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-medium text-muted-foreground text-sm">
              Draft Constructs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-3xl">{stats.draft}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Constructs</CardTitle>
                <CardDescription>
                  Your latest development constructs
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/constructs">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentConstructs.length === 0 ? (
              <div className="py-8 text-center">
                <Box className="mx-auto mb-4 size-12 text-muted-foreground" />
                <h3 className="mb-2 font-medium">No constructs yet</h3>
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
              <div className="space-y-4">
                {recentConstructs.map((construct) => (
                  <div
                    className="flex items-center justify-between rounded-lg border p-4"
                    key={construct.id}
                  >
                    <div className="flex-1">
                      <Link
                        className="font-medium hover:underline"
                        params={{ constructId: construct.id }}
                        to="/constructs/$constructId"
                      >
                        {construct.name}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-muted-foreground text-sm">
                        <Badge className="text-xs" variant="outline">
                          {construct.type}
                        </Badge>
                        <span>•</span>
                        <StatusBadge status={construct.status} />
                      </div>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        params={{ constructId: construct.id }}
                        to="/constructs/$constructId"
                      >
                        View
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and operations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full justify-start" variant="outline">
              <Link to="/constructs/new">
                <Plus className="mr-2 size-4" />
                Create New Construct
              </Link>
            </Button>
            <Button asChild className="w-full justify-start" variant="outline">
              <Link to="/constructs">
                <Box className="mr-2 size-4" />
                View All Constructs
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
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

  return (
    <Badge className="text-xs" variant={variants[status] || "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
