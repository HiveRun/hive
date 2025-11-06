import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Construct,
  constructMutations,
  constructQueries,
  worktreeMutations,
  worktreeQueries,
} from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

export function ConstructList() {
  const [pendingDelete, setPendingDelete] = useState<Construct | null>(null);

  const queryClient = useQueryClient();

  const {
    data: constructs,
    isLoading,
    error,
  } = useQuery(constructQueries.all());
  const { data: templates } = useQuery(templateQueries.all());
  const { data: worktrees } = useQuery(worktreeQueries.all());

  const deleteMutation = useMutation({
    ...constructMutations.delete,
    onSuccess: () => {
      toast.success("Construct deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      setPendingDelete(null);
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to delete construct";
      toast.error(message);
    },
  });

  const createWorktreeMutation = useMutation({
    ...worktreeMutations.create,
    onSuccess: (_data, variables) => {
      toast.success(`Worktree created for ${variables.constructId}`);
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to create worktree";
      toast.error(message);
    },
  });

  const removeWorktreeMutation = useMutation({
    ...worktreeMutations.remove,
    onSuccess: (_, constructId) => {
      toast.success(`Worktree removed for ${constructId}`);
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to remove worktree";
      toast.error(message);
    },
  });

  const handleConfirmDelete = () => {
    if (!pendingDelete) {
      return;
    }

    deleteMutation.mutate(pendingDelete.id);
  };

  const getTemplateLabel = (templateId: string) =>
    templates?.find((template) => template.id === templateId)?.label ??
    templateId;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getWorktreeForConstruct = (constructId: string) =>
    worktrees?.find((wt) => wt.id === constructId && !wt.isMain);

  const hasWorktree = (constructId: string) =>
    !!getWorktreeForConstruct(constructId);

  const handleCreateWorktree = (constructId: string) => {
    createWorktreeMutation.mutate({ constructId });
  };

  const handleRemoveWorktree = (constructId: string) => {
    removeWorktreeMutation.mutate(constructId);
  };

  if (isLoading) {
    return <div className="p-6">Loading constructs...</div>;
  }

  if (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load constructs";
    return (
      <div className="p-6 text-red-600">
        Error loading constructs: {message}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-3xl">Constructs</h1>
        <Link to="/constructs/new">
          <Button type="button">
            <Plus className="mr-2 h-4 w-4" />
            New Construct
          </Button>
        </Link>
      </div>

      {pendingDelete && (
        <Card className="border border-destructive bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-destructive">
              Delete "{pendingDelete.name}"?
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
            <p className="text-muted-foreground text-sm md:mr-auto">
              This action permanently removes the construct and its metadata.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={deleteMutation.isPending}
                onClick={() => setPendingDelete(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={deleteMutation.isPending}
                onClick={handleConfirmDelete}
                type="button"
                variant="destructive"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {constructs && constructs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="mb-2 font-semibold text-lg">No constructs yet</h3>
            <p className="mb-4 text-muted-foreground">
              Create your first construct to get started with Synthetic.
            </p>
            <Link to="/constructs/new">
              <Button type="button">
                <Plus className="mr-2 h-4 w-4" />
                Create Construct
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {constructs?.map((construct) => (
            <Card
              className="transition-shadow hover:shadow-md"
              data-testid="construct-card"
              key={construct.id}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg" data-testid="construct-name">
                    {construct.name}
                  </CardTitle>
                  <div className="flex space-x-1">
                    {hasWorktree(construct.id) ? (
                      <Button
                        data-testid="remove-worktree"
                        disabled={removeWorktreeMutation.isPending}
                        onClick={() => handleRemoveWorktree(construct.id)}
                        size="sm"
                        title="Remove worktree"
                        type="button"
                        variant="ghost"
                      >
                        <GitBranch className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        data-testid="create-worktree"
                        disabled={createWorktreeMutation.isPending}
                        onClick={() => handleCreateWorktree(construct.id)}
                        size="sm"
                        title="Create worktree"
                        type="button"
                        variant="ghost"
                      >
                        <GitBranchPlus className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      data-testid="delete-construct"
                      disabled={deleteMutation.isPending}
                      onClick={() => setPendingDelete(construct)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Badge data-testid="construct-template" variant="secondary">
                  {getTemplateLabel(construct.templateId)}
                </Badge>
              </CardHeader>
              <CardContent>
                {construct.description && (
                  <p
                    className="mb-4 line-clamp-3 text-muted-foreground text-sm"
                    data-testid="construct-description"
                  >
                    {construct.description}
                  </p>
                )}

                {/* Worktree status */}
                <div className="mb-4 flex items-center gap-2">
                  {hasWorktree(construct.id) ? (
                    <Badge
                      className="flex items-center gap-1"
                      variant="default"
                    >
                      <GitBranch className="h-3 w-3" />
                      Worktree Active
                    </Badge>
                  ) : (
                    <Badge
                      className="flex items-center gap-1"
                      variant="outline"
                    >
                      <FolderOpen className="h-3 w-3" />
                      No Worktree
                    </Badge>
                  )}
                </div>

                {/* Workspace path */}
                {construct.workspacePath && (
                  <div className="mb-4">
                    <p className="text-muted-foreground text-xs">
                      <span className="font-medium">Workspace:</span>{" "}
                      {construct.workspacePath}
                    </p>
                  </div>
                )}

                <div className="text-muted-foreground text-xs">
                  <p>Created: {formatDate(construct.createdAt)}</p>
                  <p>Updated: {formatDate(construct.updatedAt)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
