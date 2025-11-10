const STATUS_APPEARANCES: Record<string, { badge: string }> = {
  working: {
    badge:
      "border-[var(--chat-status-working-border)] bg-[var(--chat-status-working-bg)] text-[var(--chat-status-working-text)]",
  },
  starting: {
    badge:
      "border-[var(--chat-status-starting-border)] bg-[var(--chat-status-starting-bg)] text-[var(--chat-status-starting-text)]",
  },
  awaiting_input: {
    badge:
      "border-[var(--chat-status-awaiting-border)] bg-[var(--chat-status-awaiting-bg)] text-[var(--chat-status-awaiting-text)]",
  },
  completed: {
    badge:
      "border-[var(--chat-status-completed-border)] bg-[var(--chat-status-completed-bg)] text-[var(--chat-status-completed-text)]",
  },
  idle: {
    badge:
      "border-[var(--chat-status-idle-border)] bg-[var(--chat-status-idle-bg)] text-[var(--chat-status-idle-text)]",
  },
  error: {
    badge:
      "border-[var(--chat-status-error-border)] bg-[var(--chat-status-error-bg)] text-[var(--chat-status-error-text)]",
  },
  default: {
    badge:
      "border-[var(--chat-status-idle-border)] bg-[var(--chat-status-idle-bg)] text-[var(--chat-status-idle-text)]",
  },
};

export function getStatusAppearance(status?: string) {
  if (!status) {
    return STATUS_APPEARANCES.default;
  }
  return STATUS_APPEARANCES[status] ?? STATUS_APPEARANCES.default;
}

export function formatStatus(status: string) {
  return status.replace(/_/g, " ").toUpperCase();
}
