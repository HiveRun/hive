import type { LucideIcon } from "lucide-react";
import { Layers } from "lucide-react";

export type MainNavItem = {
  to: "/cells/list";
  label: string;
  description?: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const MAIN_NAV_ITEMS: MainNavItem[] = [
  {
    to: "/cells/list",
    label: "Cells",
    icon: Layers,
    exact: true,
    description: "Manage your cells",
  },
];
