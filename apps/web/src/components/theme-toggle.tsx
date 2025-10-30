import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { setTheme, systemTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? systemTheme : theme;
  const isDark = currentTheme === "dark";

  if (!mounted) {
    return (
      <Button
        aria-label="Toggle theme"
        className="relative"
        size="icon"
        type="button"
        variant="ghost"
      >
        <Sun className="size-4" />
      </Button>
    );
  }

  return (
    <Button
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon"
      type="button"
      variant="ghost"
    >
      <Sun
        className={cn(
          "size-4 rotate-0 scale-100 transition-all",
          isDark && "-rotate-90 scale-0"
        )}
      />
      <Moon
        className={cn(
          "absolute size-4 rotate-90 scale-0 transition-all",
          isDark && "rotate-0 scale-100"
        )}
      />
    </Button>
  );
}
