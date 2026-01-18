import { Link, useRouterState } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
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
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { WorkspaceManagementSheet } from "@/components/workspace-management-sheet";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { MAIN_NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

type MainSidebarProps = ComponentProps<typeof Sidebar>;

export function MainSidebar({ className, ...props }: MainSidebarProps) {
  const pathname = useRouterState({
    select: (routerState) => routerState.location.pathname,
  });
  const { state: sidebarState } = useSidebar();
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
        <div className="flex h-12 items-center gap-3 transition-none group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger
            aria-label="Toggle sidebar"
            className="size-9 rounded-none border-2 border-border bg-sidebar text-sidebar-foreground shadow-[3px_3px_0_color-mix(in_oklch,var(--color-shadow-color)_65%,transparent)] transition-none hover:bg-sidebar/80 hover:text-sidebar-foreground group-data-[collapsible=icon]:mx-auto"
          />
          <Link
            aria-label="Hive home"
            className="group flex h-full items-center gap-3 uppercase tracking-[0.28em] transition-none group-data-[collapsible=icon]:hidden"
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
                <Plus className="size-3" />
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
                <Minus className="size-3" />
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
            <WorkspaceSwitcher collapsed={sidebarState === "collapsed"} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              "text-[0.6rem] text-muted-foreground uppercase tracking-[0.32em]",
              sidebarState === "collapsed" && "hidden"
            )}
          >
            Navigate
          </SidebarGroupLabel>

          <SidebarSeparator
            className={cn(
              "mx-0 bg-border",
              sidebarState === "collapsed" && "hidden"
            )}
          />

          <SidebarGroupContent>
            <SidebarMenu>
              {MAIN_NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => {
                const isActive = exact
                  ? pathname === to
                  : pathname.startsWith(to);
                return (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      asChild
                      className={cn(
                        "rounded-none border-2 border-transparent text-muted-foreground uppercase tracking-[0.18em] transition-none",
                        "data-[active=true]:border-primary data-[active=true]:bg-primary/15 data-[active=true]:text-foreground",
                        "hover:border-primary hover:bg-primary/10 hover:text-foreground",
                        "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2 group-data-[collapsible=icon]:text-foreground"
                      )}
                      isActive={isActive}
                      tooltip={label}
                    >
                      <Link
                        aria-label={label}
                        className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                        title={label}
                        to={to}
                      >
                        <Icon aria-hidden className="size-4 shrink-0" />
                        <span
                          className={cn(
                            "text-xs",
                            sidebarState === "collapsed" && "hidden"
                          )}
                        >
                          {label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
