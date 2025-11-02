import type { LucideIcon } from "lucide-react";
import { Activity, Bug, Home } from "lucide-react";

export type MainNavItem = {
  label: string;
  to: "/" | "/example-dashboard" | "/test-error";
  description?: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const MAIN_NAV_ITEMS: MainNavItem[] = [
  {
    to: "/",
    label: "Home",
    icon: Home,
    exact: true,
    description: "System status and API health",
  },
  {
    to: "/example-dashboard",
    label: "Example Dashboard",
    icon: Activity,
    description: "Interactive telemetry and analytics",
  },
  {
    to: "/test-error",
    label: "Diagnostics",
    icon: Bug,
    description: "Intentional failure route for error flows",
  },
];
