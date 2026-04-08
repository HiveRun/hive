import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
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
const noopSetUrl = (_url: string | null) => {
  // Intentionally empty for read-only preview contexts.
};

function useWebPreviewContext() {
  const context = useContext(WebPreviewContext);
  if (!context) {
    throw new Error("WebPreview sub-components must be used within WebPreview");
  }
  return context;
}

export function WebPreview({
  children,
  onUrlChange,
  url,
  viewportPreset: defaultViewportPreset = "desktop",
  isLoading = false,
  error = null,
}: {
  children: ReactNode;
  url: string | null;
  onUrlChange?: (url: string | null) => void;
  viewportPreset?: ViewportPreset;
  isLoading?: boolean;
  error?: string | null;
}) {
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(
    defaultViewportPreset
  );

  return (
    <WebPreviewContext.Provider
      value={{
        url,
        setUrl: onUrlChange ?? noopSetUrl,
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
          aria-label={tooltip}
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
  const [draftUrl, setDraftUrl] = useState(url ?? "");

  useEffect(() => {
    setDraftUrl(url ?? "");
  }, [url]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        const newUrl = event.currentTarget.value.trim();
        setUrl(newUrl || null);
      }
    },
    [setUrl]
  );

  return (
    <Input
      className={cn("h-8 w-full min-w-0 max-w-md font-mono text-xs", className)}
      onChange={(event) => setDraftUrl(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      placeholder="Enter URL and press Enter..."
      type="url"
      value={draftUrl}
    />
  );
}

export function WebPreviewBody({
  className,
  children,
  emptyState,
  previewRef,
}: {
  className?: string;
  children?: ReactNode;
  emptyState?: ReactNode;
  previewRef?: RefObject<HTMLDivElement | null>;
}) {
  const { url, viewportPreset, isLoading, error } = useWebPreviewContext();
  const fallbackTitleId = useId();

  const frameStyle = resolveViewportStyle(viewportPreset);

  if (!url) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-sm border border-border bg-card text-muted-foreground",
          className
        )}
      >
        {emptyState ?? "No URL to preview"}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-background">
      <div className="flex h-full w-full items-center justify-center overflow-auto px-2">
        <div
          className="relative overflow-hidden rounded-sm border border-border bg-card shadow-sm"
          ref={previewRef}
          style={frameStyle}
        >
          {children ?? (
            <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-background px-6 text-center">
              <div className="flex max-w-md flex-col gap-3 text-muted-foreground text-sm">
                <p
                  className="font-semibold text-foreground text-sm uppercase tracking-[0.2em]"
                  id={fallbackTitleId}
                >
                  Browser preview unavailable
                </p>
                <p>
                  This route now requires Hive Desktop so Electron can manage
                  the embedded browser surface directly.
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-muted-foreground backdrop-blur-[1px]">
              Loading…
            </div>
          ) : null}

          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 px-6 text-center text-destructive">
              {error}
            </div>
          ) : null}
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
