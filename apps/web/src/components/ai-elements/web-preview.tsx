import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ViewportPreset = "mobile" | "tablet" | "desktop";

type WebPreviewContextValue = {
  url: string | null;
  setUrl: (url: string | null) => void;
  viewportPreset: ViewportPreset;
  setViewportPreset: (preset: ViewportPreset) => void;
  isLoading: boolean;
  error: string | null;
};

const WebPreviewContext = createContext<WebPreviewContextValue | undefined>(
  undefined
);

function useWebPreviewContext() {
  const context = useContext(WebPreviewContext);
  if (!context) {
    throw new Error("WebPreview sub-components must be used within WebPreview");
  }
  return context;
}

export function WebPreview({
  children,
  url: initialUrl,
  viewportPreset: defaultViewportPreset = "desktop",
  isLoading = false,
  error = null,
}: {
  children: ReactNode;
  url: string | null;
  viewportPreset?: ViewportPreset;
  isLoading?: boolean;
  error?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);

  useEffect(() => {
    setUrl(initialUrl);
  }, [initialUrl]);

  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(
    defaultViewportPreset
  );

  return (
    <WebPreviewContext.Provider
      value={{
        url,
        setUrl,
        viewportPreset,
        setViewportPreset,
        isLoading,
        error,
      }}
    >
      <div className="flex h-full w-full flex-col gap-4 p-4">{children}</div>
    </WebPreviewContext.Provider>
  );
}

export function WebPreviewNavigation({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card p-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function WebPreviewNavigationButton({
  children,
  tooltip,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  tooltip: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function WebPreviewUrl({ className }: { className?: string }) {
  const { url, setUrl } = useWebPreviewContext();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        const input = event.currentTarget;
        const newUrl = input.value.trim();
        setUrl(newUrl || null);
      }
    },
    [setUrl]
  );

  return (
    <Input
      className={cn("h-8 w-full min-w-0 max-w-md font-mono text-xs", className)}
      onKeyDown={handleKeyDown}
      placeholder="Enter URL and press Enter..."
      type="url"
      value={url ?? ""}
    />
  );
}

export function WebPreviewBody({
  className,
  iframeProps = {},
}: {
  className?: string;
  iframeProps?: Omit<ComponentProps<"iframe">, "key" | "sandbox">;
}) {
  const { url, viewportPreset, isLoading, error } = useWebPreviewContext();

  const frameStyle = resolveViewportStyle(viewportPreset);

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-sm border border-border bg-card text-muted-foreground",
          className
        )}
      >
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive",
          className
        )}
      >
        {error}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-sm border border-border bg-card text-muted-foreground",
          className
        )}
      >
        No URL to preview
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-background">
      <div className="flex h-full w-full items-center justify-center overflow-auto px-2">
        <div
          className="overflow-hidden rounded-sm border border-border bg-card shadow-sm"
          style={frameStyle}
        >
          <iframe
            className="h-full w-full border-0 bg-background"
            key={`${viewportPreset}-${url}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            src={url}
            title="Web preview"
            {...iframeProps}
          />
        </div>
      </div>
    </div>
  );
}

export function WebPreviewConsole({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={cn("mt-4 rounded-sm border border-border bg-card", className)}
    >
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground text-xs uppercase tracking-[0.25em] hover:bg-accent">
        Developer Console
      </summary>
      <div className="border-border border-t p-3">{children}</div>
    </details>
  );
}

export function WebPreviewViewportControls({
  className,
  options,
}: {
  className?: string;
  options?: ReadonlyArray<{ id: ViewportPreset; label: string }>;
}) {
  const { viewportPreset, setViewportPreset } = useWebPreviewContext();

  const viewportOptions =
    options ??
    ([
      { id: "mobile", label: "Mobile" },
      { id: "tablet", label: "Tablet" },
      { id: "desktop", label: "Laptop" },
    ] as const);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
        Viewport
      </span>
      {viewportOptions.map((option) => (
        <Button
          key={option.id}
          onClick={() => setViewportPreset(option.id)}
          size="sm"
          type="button"
          variant={option.id === viewportPreset ? "secondary" : "outline"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function resolveViewportStyle(preset: ViewportPreset) {
  if (preset === "desktop") {
    return {
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
    } as const;
  }

  if (preset === "tablet") {
    return {
      width: "900px",
      height: "1100px",
      maxWidth: "100%",
      maxHeight: "100%",
    } as const;
  }

  return {
    width: "428px",
    height: "926px",
    maxWidth: "100%",
    maxHeight: "100%",
  } as const;
}
