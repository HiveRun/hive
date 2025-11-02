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
        "border-[#3d2817] border-r-4 bg-[#111b11] text-[#dfe5db]",
        className
      )}
      collapsible="icon"
      {...props}
    >
      <SidebarHeader className="border-[#2a3b2a] border-b bg-[#182618] px-3 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
          <SidebarTrigger
            aria-label="Toggle sidebar"
            className="size-9 rounded-none border-2 border-[#3d2817] bg-[#1a2f1a] text-[#f4f7f2] shadow-[3px_3px_0_rgba(0,0,0,0.45)] transition-none hover:bg-[#203820] hover:text-[#f4f7f2] group-data-[collapsible=icon]:mx-auto"
          />
          <Link
            aria-label="Synthetic home"
            className="group flex items-center gap-3 uppercase tracking-[0.28em] group-data-[collapsible=icon]:hidden"
            to="/"
          >
            <span
              aria-hidden
              className="block h-10 w-1 bg-[#5a7c5a] shadow-[4px_0_0_0_rgba(0,0,0,0.45)] transition-none group-hover:bg-[#6b8e6b]"
            />
            <span className="font-semibold text-[#f4f7f2] text-sm">
              Synthetic
            </span>
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-6 bg-transparent">
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              "text-[#8b9d8b] text-[0.6rem] uppercase tracking-[0.32em]",
              sidebarState === "collapsed" && "hidden"
            )}
          >
            Navigate
          </SidebarGroupLabel>

          <SidebarSeparator
            className={cn(
              "mx-0 bg-[#2a3b2a]",
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
                        "rounded-none border-2 border-transparent uppercase tracking-[0.18em] transition-none",
                        "data-[active=true]:border-[#5a7c5a] data-[active=true]:bg-[#203020] data-[active=true]:text-[#f4f7f2]",
                        "hover:border-[#5a7c5a] hover:bg-[#1b2a1b]",
                        "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2"
                      )}
                      isActive={isActive}
                    >
                      <Link
                        className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                        to={to}
                      >
                        <Icon className="size-4" />
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
      <SidebarFooter className="border-[#2a3b2a] border-t bg-[#182618] text-[#8b9d8b] text-[0.55rem] uppercase tracking-[0.28em]">
        <div className="flex items-center justify-between gap-3 px-2 py-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-0">
          <p className="px-0 text-left group-data-[collapsible=icon]:hidden">
            Press ⌘B to toggle
          </p>
          <ModeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
