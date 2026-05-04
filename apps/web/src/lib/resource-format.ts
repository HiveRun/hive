const BYTES_PER_UNIT = 1024;
const ZERO_DECIMALS = 0;
const ONE_DECIMAL = 1;

export function formatCpuPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unavailable";
  }
  return `${value.toFixed(1)}%`;
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return "Unavailable";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= BYTES_PER_UNIT && unitIndex < units.length - 1) {
    size /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? ZERO_DECIMALS : ONE_DECIMAL)} ${units[unitIndex]}`;
}

export const serviceStatusTone = (status: string): string => {
  const toneMap: Record<string, string> = {
    running: "bg-primary/15 text-primary",
    starting: "bg-secondary/20 text-secondary-foreground",
    pending: "bg-muted text-muted-foreground",
    needs_resume: "bg-secondary/20 text-secondary-foreground",
    error: "bg-destructive/10 text-destructive",
    stopped: "bg-border/20 text-muted-foreground",
  };

  return toneMap[status.toLowerCase()] ?? "bg-muted text-muted-foreground";
};
