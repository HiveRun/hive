import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  FileText,
  Home,
  Layers,
  Terminal,
} from "lucide-react";

export type MainNavItem = {
  to:
    | "/"
    | "/example-dashboard"
    | "/test-error"
    | "/templates"
    | "/constructs/list"
    | "/opencode-test";
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
    to: "/constructs/list",
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
  {
    to: "/opencode-test",
    label: "OpenCode Test",
    icon: Terminal,
    description: "Spawn and manage OpenCode servers",
  },
];
