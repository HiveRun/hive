import type { LucideIcon } from "lucide-react";

export type MainNavItem = {
  to: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const MAIN_NAV_ITEMS: MainNavItem[] = [];
