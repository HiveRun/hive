import type { ReactNode } from "react";

import { MainSidebar } from "@/components/main-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import Loader from "./loader";

type MainLayoutProps = {
  children: ReactNode;
  isLoading?: boolean;
};

export function MainLayout({ children, isLoading = false }: MainLayoutProps) {
  return (
    <SidebarProvider className="relative min-h-svh bg-[#0f170f] text-foreground">
      <MainSidebar />
      <SidebarInset className="relative flex min-h-svh flex-col overflow-hidden bg-transparent">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(90,124,90,0.08),_transparent_70%),_radial-gradient(circle_at_bottom_right,_rgba(76,104,76,0.16),_transparent_65%)]"
        />
        <div className="relative z-20 flex items-center justify-between border-[#2a3b2a] border-b bg-[#141f14]/95 px-3 py-3 md:hidden">
          <div className="flex items-center gap-3">
            <SidebarTrigger
              aria-label="Toggle navigation"
              className="size-9 rounded-none border-2 border-[#3d2817] bg-[#1a2f1a] text-[#f4f7f2] shadow-[3px_3px_0_rgba(0,0,0,0.45)] transition-none hover:bg-[#203820] hover:text-[#f4f7f2]"
            />
            <span className="font-semibold text-[#f4f7f2] text-sm uppercase tracking-[0.32em]">
              Synthetic
            </span>
          </div>
          <ModeToggle />
        </div>
        <div className="relative z-10 flex flex-1 flex-col">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[#3d2817]/35"
          />
          <div className="relative flex flex-1 flex-col">
            {children}
            {isLoading ? (
              <div className="absolute inset-0 grid place-items-center bg-[#0f170f]/85 backdrop-blur-sm">
                <Loader />
              </div>
            ) : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
