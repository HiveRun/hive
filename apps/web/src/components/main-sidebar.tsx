import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentProps } from "react";
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
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { MAIN_NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

type MainSidebarProps = ComponentProps<typeof Sidebar>;

export function MainSidebar({ className, ...props }: MainSidebarProps) {
  const pathname = useRouterState({
    select: (routerState) => routerState.location.pathname,
  });
  const { state: sidebarState } = useSidebar();

  return (
    <Sidebar
      className={cn(
        "border-[#284334] border-r-4 bg-sidebar text-sidebar-foreground",
        className
      )}
      collapsible="icon"
      {...props}
    >
      <SidebarHeader className="border-border border-b bg-sidebar px-3 py-3">
        <div className="flex h-12 items-center gap-3 transition-none group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger
            aria-label="Toggle sidebar"
            className="size-9 rounded-none border-2 border-[#284334] bg-[#1a2f1a] text-[#f4f7f2] shadow-[3px_3px_0_rgba(0,0,0,0.65)] transition-none hover:bg-[#203820] hover:text-[#f4f7f2] group-data-[collapsible=icon]:mx-auto"
          />
          <Link
            aria-label="Synthetic home"
            className="group flex h-full items-center gap-3 uppercase tracking-[0.28em] transition-none group-data-[collapsible=icon]:hidden"
            to="/"
          >
            <span
              aria-hidden
              className="block h-10 w-1 bg-[#5a7c5a] shadow-[4px_0_0_0_rgba(0,0,0,0.45)] transition-none group-hover:bg-[#6b8e6b]"
            />
            <span className="font-semibold text-foreground text-sm">
              Synthetic
            </span>
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-6 bg-transparent">
        <SidebarGroup>
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
                        "data-[active=true]:border-[#5a7c5a] data-[active=true]:bg-[#22382a] data-[active=true]:text-[#f4f7f2]",
                        "hover:border-[#5a7c5a] hover:bg-[#22382a] hover:text-[#f4f7f2]",
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
            "flex items-center justify-between gap-3 px-2 py-2",
            sidebarState === "collapsed" && "justify-center px-0"
          )}
        >
          {sidebarState !== "collapsed" && (
            <p className="px-0 text-left">Press ⌘B to toggle</p>
          )}
          <div className="shrink-0">
            <ModeToggle />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
