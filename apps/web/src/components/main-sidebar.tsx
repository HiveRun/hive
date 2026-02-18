import { Link, useRouterState } from "@tanstack/react-router";
import { Clock3, Home, Minus, Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceManagementSheet } from "@/components/workspace-management-sheet";
import { WorkspaceTree } from "@/components/workspace-tree";
import { cn } from "@/lib/utils";

type MainSidebarProps = ComponentProps<typeof Sidebar>;

export function MainSidebar({ className, ...props }: MainSidebarProps) {
  const { state: sidebarState } = useSidebar();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);
  const [sheetDefaultSection, setSheetDefaultSection] = useState<
    "register" | "list"
  >("list");

  return (
    <Sidebar
      className={cn(
        "border-border border-r-4 bg-sidebar text-sidebar-foreground",
        className
      )}
      collapsible="icon"
      {...props}
    >
      <SidebarHeader className="border-border border-b bg-sidebar px-3 py-3">
        <div
          className={cn(
            "transition-none",
            sidebarState === "collapsed"
              ? "flex flex-col items-center gap-2"
              : "flex h-12 items-center justify-between gap-3"
          )}
        >
          <SidebarTrigger
            aria-label="Toggle sidebar"
            className="size-9 rounded-none border-2 border-border bg-sidebar text-sidebar-foreground shadow-[3px_3px_0_color-mix(in_oklch,var(--color-shadow-color)_65%,transparent)] transition-none hover:bg-sidebar/80 hover:text-sidebar-foreground"
          />

          {sidebarState === "collapsed" ? null : (
            <Link
              aria-label="Hive home"
              className="group flex h-full items-center gap-3 uppercase tracking-[0.28em] transition-none"
              to="/"
            >
              <span
                aria-hidden
                className="block h-10 w-1 bg-primary shadow-[4px_0_0_0_color-mix(in_oklch,var(--color-shadow-color)_45%,transparent)] transition-none group-hover:bg-primary/80"
              />
              <span className="flex items-center gap-2 font-semibold text-foreground text-sm">
                <span aria-hidden className="text-lg leading-none">
                  🐝
                </span>
                <span>HIVE</span>
              </span>
            </Link>
          )}

          {sidebarState === "collapsed" ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  aria-label="Overview"
                  className={cn(
                    "flex size-9 items-center justify-center rounded-none border-2 border-border bg-sidebar text-sidebar-foreground shadow-[3px_3px_0_color-mix(in_oklch,var(--color-shadow-color)_65%,transparent)] transition-none hover:bg-sidebar/80 hover:text-sidebar-foreground",
                    pathname === "/" && "border-primary bg-primary/10"
                  )}
                  title="Overview"
                  to="/"
                >
                  <Home aria-hidden className="size-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">Overview</TooltipContent>
            </Tooltip>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-6 bg-transparent">
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              "flex items-center justify-between gap-2 text-[0.6rem] text-muted-foreground uppercase tracking-[0.32em]",
              sidebarState === "collapsed" && "hidden"
            )}
          >
            <span>Workspaces</span>
            <div className="flex gap-1">
              <button
                aria-label="Register new workspace"
                className="flex size-5 items-center justify-center rounded border-2 border-border transition-none hover:border-primary hover:bg-primary/10"
                onClick={() => {
                  setSheetDefaultSection("register");
                  setWorkspaceSheetOpen(true);
                }}
                type="button"
              >
                <Plus className="size-4" />
              </button>
              <button
                aria-label="Manage workspaces"
                className="flex size-5 items-center justify-center rounded border-2 border-border transition-none hover:border-primary hover:bg-primary/10"
                onClick={() => {
                  setSheetDefaultSection("list");
                  setWorkspaceSheetOpen(true);
                }}
                type="button"
              >
                <Minus className="size-4" />
              </button>
            </div>
            <WorkspaceManagementSheet
              defaultRegisterOpen={sheetDefaultSection === "register"}
              onOpenChange={setWorkspaceSheetOpen}
              open={workspaceSheetOpen}
              section={sheetDefaultSection}
            />
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <WorkspaceTree collapsed={sidebarState === "collapsed"} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              "text-[0.6rem] text-muted-foreground uppercase tracking-[0.32em]",
              sidebarState === "collapsed" && "hidden"
            )}
          >
            Observability
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className={cn(
                    "relative box-border w-full rounded-none border-2 border-transparent bg-transparent py-1.5 pr-4 pl-3 text-left text-muted-foreground text-xs tracking-normal transition-none",
                    "hover:bg-primary/5 hover:text-foreground",
                    (pathname.startsWith("/global-timings") ||
                      pathname.startsWith("/timings")) &&
                      "bg-primary/10 text-foreground shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
                  )}
                  tooltip="Global timings"
                >
                  <Link aria-label="Global timings" to="/global-timings">
                    <Clock3 className="size-4" />
                    <span>Global Timings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-border border-t bg-sidebar text-[0.55rem] text-muted-foreground uppercase tracking-[0.28em]">
        <div
          className={cn(
            "flex items-center justify-end gap-3 px-2 py-2",
            sidebarState === "collapsed" && "justify-center px-0"
          )}
        >
          <div className="shrink-0">
            <ModeToggle />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
