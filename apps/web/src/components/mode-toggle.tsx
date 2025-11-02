import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-10 w-10 rounded-none border-2 border-[#3d2817] bg-[#1a2f1a] text-[#f4f7f2] shadow-[3px_3px_0_rgba(0,0,0,0.45)] transition-none",
            "hover:bg-[#203820] hover:text-[#f4f7f2]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5a7c5a] focus-visible:outline-offset-2"
          )}
          size="icon"
          variant="outline"
        >
          <Sun className="dark:-rotate-90 h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="rounded-none border-2 border-[#3d2817] bg-background px-0 py-0 shadow-[4px_4px_0_rgba(0,0,0,0.45)]"
      >
        <DropdownMenuItem
          className="rounded-none uppercase tracking-[0.3em]"
          onClick={() => setTheme("light")}
        >
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-none uppercase tracking-[0.3em]"
          onClick={() => setTheme("dark")}
        >
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-none uppercase tracking-[0.3em]"
          onClick={() => setTheme("system")}
        >
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
