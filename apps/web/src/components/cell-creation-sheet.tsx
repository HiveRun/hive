import { useNavigate } from "@tanstack/react-router";
import { CellForm, type CellFormInitialPrefill } from "@/components/cell-form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type CellCreationSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceLabel?: string;
  initialPrefill?: CellFormInitialPrefill;
};

export function CellCreationSheet({
  initialPrefill,
  open,
  onOpenChange,
  workspaceId,
  workspaceLabel,
}: CellCreationSheetProps) {
  const navigate = useNavigate();

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-2xl"
        side="right"
      >
        <SheetHeader>
          <SheetTitle>Create New Cell</SheetTitle>
          <SheetDescription>
            {workspaceLabel
              ? `Create a new cell in ${workspaceLabel}.`
              : "Create a new cell."}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4">
          <CellForm
            initialPrefill={initialPrefill}
            onCancel={() => onOpenChange(false)}
            onCreated={(cell) => {
              onOpenChange(false);
              navigate({
                to: "/cells/$cellId",
                params: { cellId: cell.id },
                search: { workspaceId: cell.workspaceId },
              });
            }}
            workspaceId={workspaceId}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
