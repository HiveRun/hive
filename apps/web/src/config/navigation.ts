import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Bell,
  FileText,
  Home,
  Layers,
} from "lucide-react";

export type MainNavItem = {
  to:
    | "/"
    | "/example-dashboard"
    | "/test-error"
    | "/templates"
    | "/cells/list"
    | "/debug-notifications";
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
    to: "/cells/list",
    label: "Cells",
    icon: Layers,
    description: "Manage your cells",
  },
  {
    to: "/templates",
    label: "Templates",
    icon: FileText,
    description: "Browse cell templates",
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
  {
    to: "/debug-notifications",
    label: "Debug Notifications",
    icon: Bell,
    description: "Open the Tauri notification trigger",
  },
];
