import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { CellCreationSheet } from "@/components/cell-creation-sheet";
import { CommandMenu } from "@/components/command-menu";
import { MainSidebar } from "@/components/main-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { WorkspaceManagementSheet } from "@/components/workspace-management-sheet";
import { workspaceQueries } from "@/queries/workspaces";

type MainLayoutProps = {
  children: ReactNode;
};

export function MainLayout({ children }: MainLayoutProps) {
  const workspaceQuery = useQuery(workspaceQueries.list());
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [workspaceSheetSection, setWorkspaceSheetSection] = useState<
    "register" | "list"
  >("list");
  const [cellCreateWorkspaceId, setCellCreateWorkspaceId] = useState<
    string | null
  >(null);
  const workspaces = workspaceQuery.data?.workspaces ?? [];
  const activeWorkspaceId = workspaceQuery.data?.activeWorkspaceId ?? undefined;
  const selectedCreateWorkspace = workspaces.find(
    (workspace) => workspace.id === cellCreateWorkspaceId
  );

  const openWorkspaceSheet = (section: "register" | "list") => {
    setWorkspaceSheetSection(section);
    setWorkspaceSheetOpen(true);
  };

  const openCellCreation = (workspaceId?: string) => {
    const targetWorkspaceId =
      workspaceId ?? activeWorkspaceId ?? workspaces[0]?.id;
    if (!targetWorkspaceId) {
      openWorkspaceSheet("register");
      return;
    }
    setCellCreateWorkspaceId(targetWorkspaceId);
  };

  return (
    <SidebarProvider className="relative h-full bg-background text-foreground transition-colors">
      <CommandMenu
        onCreateCell={openCellCreation}
        onManageWorkspaces={() => openWorkspaceSheet("list")}
        onRegisterWorkspace={() => openWorkspaceSheet("register")}
      />
      {cellCreateWorkspaceId ? (
        <CellCreationSheet
          onOpenChange={(open) => {
            if (!open) {
              setCellCreateWorkspaceId(null);
            }
          }}
          open={cellCreateWorkspaceId !== null}
          workspaceId={cellCreateWorkspaceId}
          workspaceLabel={selectedCreateWorkspace?.label}
        />
      ) : null}
      <WorkspaceManagementSheet
        defaultRegisterOpen={workspaceSheetSection === "register"}
        onOpenChange={setWorkspaceSheetOpen}
        open={workspaceSheetOpen}
        section={workspaceSheetSection}
      />
      <MainSidebar
        onManageWorkspaces={() => openWorkspaceSheet("list")}
        onRegisterWorkspace={() => openWorkspaceSheet("register")}
      />
      <SidebarInset className="relative flex h-full flex-col overflow-hidden bg-transparent">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(148,163,184,0.18),_transparent_70%),_radial-gradient(circle_at_bottom_right,_rgba(30,41,59,0.18),_transparent_70%)]"
        />
        <div className="relative z-20 flex items-center justify-between border-border border-b bg-card/95 px-3 py-3 shadow-[4px_4px_0_rgba(0,0,0,0.35)] md:hidden">
          <div className="flex items-center gap-3">
            <SidebarTrigger
              aria-label="Toggle navigation"
              className="size-9 rounded-none border-2 border-border bg-card text-foreground shadow-[3px_3px_0_rgba(0,0,0,0.45)] transition-none hover:bg-muted hover:text-foreground"
            />
            <span className="font-semibold text-foreground text-sm uppercase tracking-[0.32em]">
              Hive
            </span>
          </div>
          <ModeToggle />
        </div>
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-0 h-px bg-border/60"
          />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
