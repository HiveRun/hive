import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const [pendingDelete, setPendingDelete] = useState<Construct | null>(null);
  const [selectedConstructIds, setSelectedConstructIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isClientReady, setIsClientReady] = useState(false);

  const queryClient = useQueryClient();

  const {
    data: constructs,
    isLoading,
    error,
  } = useQuery(constructQueries.all());
  const { data: templates } = useQuery(templateQueries.all());

  useEffect(() => {
    setIsClientReady(true);
    return () => setIsClientReady(false);
  }, []);

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

  const deleteMutation = useMutation({
    ...constructMutations.delete,
    onSuccess: () => {
      toast.success("Construct deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
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

  const bulkDeleteMutation = useMutation({
    ...constructMutations.deleteMany,
    onSuccess: (data: { deletedIds: string[] }) => {
      const count = data.deletedIds.length;
      const label = count === 1 ? "construct" : "constructs";
      toast.success(`Deleted ${count} ${label}`);
      queryClient.invalidateQueries({ queryKey: ["constructs"] });
      setSelectedConstructIds(new Set());
    },
    onError: (unknownError) => {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to delete constructs";
      toast.error(message);
    },
  });

  const mutationsDisabled =
    deleteMutation.isPending || bulkDeleteMutation.isPending;

  const handleConfirmDelete = () => {
    if (!pendingDelete) {
      return;
    }

    deleteMutation.mutate(pendingDelete.id);
  };

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
              {isAllSelected ? "Clear Selection" : "Select All"}
            </Button>
          )}
          <Link to="/constructs/new">
            <Button type="button">
              <Plus className="mr-2 h-4 w-4" />
              New Construct
            </Button>
          </Link>
        </div>
      </div>

      {hasSelection && (
        <BulkDeleteToolbar
          disableActions={bulkDeleteMutation.isPending}
          isAllSelected={isAllSelected}
          isClientReady={isClientReady}
          onClearSelection={handleClearSelection}
          onConfirmDelete={handleBulkDelete}
          onToggleSelectAll={handleSelectAllToggle}
          selectedConstructs={selectedConstructs}
          selectedCount={selectedCount}
        />
      )}

      <PendingDeleteDialog
        disabled={mutationsDisabled}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        pendingDelete={pendingDelete}
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
              disableDelete={mutationsDisabled}
              disableSelection={bulkDeleteMutation.isPending}
              isSelected={selectedConstructIds.has(construct.id)}
              key={construct.id}
              onCopyWorkspace={copyToClipboard}
              onDelete={() => setPendingDelete(construct)}
              onToggleSelect={() => toggleConstructSelection(construct.id)}
              templateLabel={getTemplateLabel(construct.templateId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type BulkDeleteToolbarProps = {
  selectedConstructs: Construct[];
  selectedCount: number;
  isAllSelected: boolean;
  disableActions: boolean;
  isClientReady: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onConfirmDelete: () => void;
};

function BulkDeleteToolbar({
  disableActions,
  isAllSelected,
  isClientReady,
  onClearSelection,
  onConfirmDelete,
  onToggleSelectAll,
  selectedConstructs,
  selectedCount,
}: BulkDeleteToolbarProps) {
  const selectionPreview = selectedConstructs.slice(0, MAX_SELECTION_PREVIEW);
  const overflowCount = selectedCount - selectionPreview.length;

  if (!isClientReady) {
    return null;
  }

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!portalTarget) {
    return null;
  }

  const content = (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <Card
        aria-live="polite"
        className="pointer-events-auto w-full max-w-4xl border border-primary bg-background shadow-2xl"
        data-testid="bulk-delete-toolbar"
        role="region"
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-primary">
            <Trash2 className="h-4 w-4" />
            Delete {selectedCount}{" "}
            {selectedCount === 1 ? "construct" : "constructs"}?
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 text-muted-foreground text-sm md:mr-auto">
            <p>
              This action permanently removes the selected constructs and their
              metadata.
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {selectionPreview.map((construct) => (
                <li key={construct.id}>{construct.name}</li>
              ))}
              {overflowCount > 0 && <li>+{overflowCount} more</li>}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="select-all"
              disabled={disableActions}
              onClick={onToggleSelectAll}
              type="button"
              variant="secondary"
            >
              {isAllSelected ? "Clear All" : "Select All"}
            </Button>
            <Button
              data-testid="clear-selection"
              disabled={disableActions}
              onClick={onClearSelection}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-bulk-delete"
              disabled={disableActions}
              onClick={onConfirmDelete}
              type="button"
              variant="destructive"
            >
              {disableActions ? "Deleting..." : `Delete ${selectedCount}`}
              <Trash2 className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return createPortal(content, portalTarget);
}

type PendingDeleteDialogProps = {
  pendingDelete: Construct | null;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function PendingDeleteDialog({
  disabled,
  onCancel,
  onConfirm,
  pendingDelete,
}: PendingDeleteDialogProps) {
  if (!pendingDelete) {
    return null;
  }

  return (
    <AlertDialog
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel();
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{pendingDelete.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This action permanently removes the construct and its related
            metadata. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-muted bg-muted/30 p-4 text-sm">
          <p className="font-semibold">Construct Summary</p>
          <p className="text-muted-foreground">
            Template: {pendingDelete.templateId}
          </p>
          {pendingDelete.workspacePath ? (
            <p className="text-muted-foreground">
              Workspace: {pendingDelete.workspacePath}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              disabled={disabled}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={disabled}
            onClick={onConfirm}
          >
            {disabled ? "Deleting..." : "Delete"}
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
  disableDelete: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onCopyWorkspace: (path: string) => void;
};

function ConstructCard({
  construct,
  createdLabel,
  disableDelete,
  disableSelection,
  isSelected,
  onCopyWorkspace,
  onDelete,
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
          <div className="flex space-x-1">
            <Button
              data-testid="delete-construct"
              disabled={disableDelete}
              onClick={onDelete}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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
