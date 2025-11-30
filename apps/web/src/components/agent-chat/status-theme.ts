const STATUS_APPEARANCES = {
  working: {
    badge: "border border-primary bg-primary/10 text-primary-foreground",
  },
  starting: {
    badge: "border border-secondary bg-secondary/20 text-secondary-foreground",
  },
  completed: {
    badge: "border border-primary/70 bg-primary/15 text-primary-foreground",
  },
  awaiting_input: {
    badge: "border border-muted bg-muted text-muted-foreground",
  },
  error: {
    badge:
      "border border-destructive bg-destructive/10 text-destructive-foreground",
  },
  default: {
    badge: "border border-border bg-card text-muted-foreground",
  },
} as const;

type StatusAppearance =
  (typeof STATUS_APPEARANCES)[keyof typeof STATUS_APPEARANCES];

export function getStatusAppearance(status?: string): StatusAppearance {
  if (!status) {
    return STATUS_APPEARANCES.default;
  }
  const appearances = STATUS_APPEARANCES as Record<string, StatusAppearance>;
  return appearances[status] ?? STATUS_APPEARANCES.default;
}

export function formatStatus(status: string) {
  return status.replace(/_/g, " ").toUpperCase();
}
