import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  type Construct,
  constructMutations,
  constructQueries,
} from "@/queries/constructs";
import { templateQueries } from "@/queries/templates";

const MAX_SELECTION_PREVIEW = 3;

export function ConstructList() {
  const [selectedConstructIds, setSelectedConstructIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);

  const queryClient = useQueryClient();

  const {
    data: constructs,
    isLoading,
    error,
  } = useQuery(constructQueries.all());
  const { data: templates } = useQuery(templateQueries.all());

  useEffect(() => {
    if (!constructs) {
      setSelectedConstructIds((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        return new Set();
      });
      return;
    }

    const validIds = new Set(constructs.map((construct) => construct.id));
    setSelectedConstructIds((prev) => {
      const filtered = [...prev].filter((id) => validIds.has(id));
      if (filtered.length === prev.size) {
        return prev;
      }
      return new Set(filtered);
    });
  }, [constructs]);

  const selectedConstructs =
    constructs?.filter((construct) => selectedConstructIds.has(construct.id)) ??
    [];
  const selectedCount = selectedConstructs.length;
  const hasSelection = selectedCount > 0;
  const isAllSelected = Boolean(
    constructs?.length && selectedCount === constructs.length
  );
  const bulkDeleteButtonLabel = isAllSelected
    ? `Delete All (${selectedCount})`
    : `Delete Selected (${selectedCount})`;

  useEffect(() => {
    if (!hasSelection) {
      setIsBulkDialogOpen(false);
    }
  }, [hasSelection]);

  const bulkDeleteMutation = useMutation({
    ...constructMutations.deleteMany,
    onSuccess: (data: { deletedIds: string[] }) => {
      const count = data.deletedIds.length;
      const label = count === 1 ? "construct" : "constructs";
      toast.success(`Deleted ${count} ${label}`);
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
      setSelectedConstructIds(new Set());
      setIsBulkDialogOpen(false);
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to delete constructs";
      toast.error(message);
    },
  });

  const handleBulkDelete = () => {
    if (!hasSelection) {
      return;
    }

    bulkDeleteMutation.mutate(Array.from(selectedConstructIds));
  };

  const handleClearSelection = () => {
    setSelectedConstructIds(new Set());
  };

  const handleSelectAllToggle = () => {
    if (!constructs?.length) {
      return;
    }

    setSelectedConstructIds((prev) => {
      if (prev.size === constructs.length) {
        return new Set();
      }
      return new Set(constructs.map((construct) => construct.id));
    });
  };

  const toggleConstructSelection = (constructId: string) => {
    setSelectedConstructIds((prev) => {
      const next = new Set(prev);
      if (next.has(constructId)) {
        next.delete(constructId);
      } else {
        next.add(constructId);
      }
      return next;
    });
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (_error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading constructs...</div>;
  }

  if (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load constructs";
    return (
      <div className="p-6 text-destructive">
        Error loading constructs: {message}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-bold text-3xl">Constructs</h1>
        <div className="flex flex-wrap gap-2">
          {constructs && constructs.length > 0 && (
            <Button
              data-testid="toggle-select-all-global"
              onClick={handleSelectAllToggle}
              type="button"
              variant="outline"
            >
              Select All
            </Button>
          )}
          {hasSelection && (
            <>
              <Button
                data-testid="clear-selection"
                onClick={handleClearSelection}
                type="button"
                variant="outline"
              >
                Clear Selection
              </Button>
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="delete-selected"
                onClick={() => setIsBulkDialogOpen(true)}
                type="button"
                variant="destructive"
              >
                {bulkDeleteButtonLabel}
              </Button>
            </>
          )}
          <Link to="/constructs/new">
            <Button type="button">
              <Plus className="mr-2 h-4 w-4" />
              New Construct
            </Button>
          </Link>
        </div>
      </div>

      <BulkDeleteDialog
        disableActions={bulkDeleteMutation.isPending}
        isOpen={isBulkDialogOpen && hasSelection}
        onConfirmDelete={handleBulkDelete}
        onOpenChange={setIsBulkDialogOpen}
        selectedConstructs={selectedConstructs}
        selectedCount={selectedCount}
      />

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
            <ConstructCard
              construct={construct}
              createdLabel={formatDate(construct.createdAt)}
              disableSelection={bulkDeleteMutation.isPending}
              isSelected={selectedConstructIds.has(construct.id)}
              key={construct.id}
              onCopyWorkspace={copyToClipboard}
              onToggleSelect={() => toggleConstructSelection(construct.id)}
              templateLabel={getTemplateLabel(construct.templateId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type BulkDeleteDialogProps = {
  disableActions: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  selectedConstructs: Construct[];
  selectedCount: number;
};

function BulkDeleteDialog({
  disableActions,
  isOpen,
  onOpenChange,
  onConfirmDelete,
  selectedConstructs,
  selectedCount,
}: BulkDeleteDialogProps) {
  if (!selectedCount) {
    return null;
  }

  const selectionPreview = selectedConstructs.slice(0, MAX_SELECTION_PREVIEW);
  const overflowCount = selectedCount - selectionPreview.length;

  return (
    <AlertDialog onOpenChange={onOpenChange} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {selectedCount}{" "}
            {selectedCount === 1 ? "construct" : "constructs"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action permanently removes the selected constructs and their
            metadata. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-muted bg-muted/30 p-4 text-sm">
          <p className="font-semibold">Selection Summary</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {selectionPreview.map((construct) => (
              <li key={construct.id}>{construct.name}</li>
            ))}
            {overflowCount > 0 && <li>+{overflowCount} more</li>}
          </ul>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disableActions} type="button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="confirm-bulk-delete"
            disabled={disableActions}
            onClick={onConfirmDelete}
          >
            {disableActions ? "Deleting..." : `Delete ${selectedCount}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConstructCardProps = {
  construct: Construct;
  templateLabel: string;
  createdLabel: string;
  isSelected: boolean;
  disableSelection: boolean;
  onToggleSelect: () => void;
  onCopyWorkspace: (path: string) => void;
};

function ConstructCard({
  construct,
  createdLabel,
  disableSelection,
  isSelected,
  onCopyWorkspace,
  onToggleSelect,
  templateLabel,
}: ConstructCardProps) {
  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        isSelected && "border-primary bg-primary/5 shadow-sm"
      )}
      data-testid="construct-card"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label={`Select construct ${construct.name}`}
              checked={isSelected}
              className="h-5 w-5 border-2 border-muted-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary"
              data-construct-id={construct.id}
              data-testid="construct-select"
              disabled={disableSelection}
              onCheckedChange={() => onToggleSelect()}
            />
            <CardTitle className="text-lg" data-testid="construct-name">
              {construct.name}
            </CardTitle>
          </div>
        </div>
        <Badge data-testid="construct-template" variant="secondary">
          {templateLabel}
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

        {construct.workspacePath && (
          <div className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-muted-foreground text-xs">
                Workspace:
              </p>
              <Button
                data-testid="copy-workspace-path"
                onClick={() => onCopyWorkspace(construct.workspacePath)}
                size="sm"
                title="Copy workspace path"
                type="button"
                variant="ghost"
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="mt-1 break-all rounded bg-muted/50 p-2 font-mono text-muted-foreground text-xs">
              {construct.workspacePath}
            </p>
          </div>
        )}

        <div className="text-muted-foreground text-xs">
          <p>Created: {createdLabel}</p>
        </div>
      </CardContent>
    </Card>
  );
}
