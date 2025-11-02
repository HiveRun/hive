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
    <SidebarProvider className="relative min-h-svh bg-background text-foreground transition-colors">
      <MainSidebar />
      <SidebarInset className="relative flex min-h-svh flex-col overflow-hidden bg-transparent">
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
              Synthetic
            </span>
          </div>
          <ModeToggle />
        </div>
        <div className="relative z-10 flex flex-1 flex-col">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-0 h-px bg-border/60"
          />
          <div className="relative flex flex-1 flex-col">
            {children}
            {isLoading ? (
              <div className="absolute inset-0 grid place-items-center bg-background/85 backdrop-blur-sm">
                <Loader />
              </div>
            ) : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
