import { useSyncExternalStore } from "react";
import {
  getDesktopStartupSnapshot,
  subscribeDesktopStartup,
} from "@/lib/desktop-startup";

export const useDesktopStartup = () =>
  useSyncExternalStore(
    subscribeDesktopStartup,
    getDesktopStartupSnapshot,
    getDesktopStartupSnapshot
  );
