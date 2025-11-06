import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, FileText, Home, Layers } from "lucide-react";

export type MainNavItem = {
  to: "/" | "/example-dashboard" | "/test-error" | "/templates" | "/constructs";
  label: string;
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
    to: "/constructs",
    label: "Constructs",
    icon: Layers,
    description: "Manage your constructs",
  },
  {
    to: "/templates",
    label: "Templates",
    icon: FileText,
    description: "Browse construct templates",
  },
  {
    to: "/example-dashboard",
    label: "Example Dashboard",
    icon: Activity,
    description: "Interactive telemetry and analytics",
  },
  {
    to: "/test-error",
    label: "Example Error",
    icon: AlertTriangle,
    description: "Intentional failure route for error flows",
  },
];
