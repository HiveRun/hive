"use client";

import {
  Terminal,
  TerminalActions,
  TerminalClearButton,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import { cn } from "@/lib/utils";

type LogTerminalProps = {
  output: string;
  onClear?: () => void;
  title?: string;
  className?: string;
  autoScroll?: boolean;
};

export function LogTerminal({
  output,
  onClear,
  title = "Logs",
  className,
  autoScroll = true,
}: LogTerminalProps) {
  return (
    <Terminal
      autoScroll={autoScroll}
      className={cn(
        // Hive Resonant Brutalism theme overrides
        "h-full flex-1 rounded-none border-[3px] border-border bg-card text-foreground",
        className
      )}
      onClear={onClear}
      output={output}
    >
      <TerminalHeader className="border-border/60 border-b bg-muted/10 px-3 py-2">
        <TerminalTitle className="flex items-center gap-2 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.3em]">
          {title}
        </TerminalTitle>
        <div className="flex items-center gap-1">
          <TerminalStatus className="text-[10px] text-muted-foreground" />
          <TerminalActions>
            <TerminalCopyButton
              className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
              variant="ghost"
            />
            {onClear && (
              <TerminalClearButton
                className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                variant="ghost"
              />
            )}
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent className="max-h-none flex-1 bg-card p-3 font-mono text-[11px] leading-relaxed" />
    </Terminal>
  );
}
