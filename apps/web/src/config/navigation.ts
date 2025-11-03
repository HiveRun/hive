import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Box, Home } from "lucide-react";

export type MainNavItem = {
  label: string;
  to: "/" | "/constructs" | "/test-error";
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
    description: "System status and overview",
  },
  {
    to: "/constructs",
    label: "Constructs",
    icon: Box,
    description: "Manage development constructs",
  },
  {
    to: "/test-error",
    label: "Example Error",
    icon: AlertTriangle,
    description: "Intentional failure route for error flows",
  },
];
