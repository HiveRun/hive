const MODIFIED_ENTER_SEQUENCES = {
  alt: "\x1b[13;3u",
  ctrl: "\x1b[13;5u",
  shift: "\x1b[13;2u",
} as const;

export function getModifiedEnterInput(event: KeyboardEvent): string | null {
  if (event.type !== "keydown" || event.key !== "Enter" || event.metaKey) {
    return null;
  }

  if (event.shiftKey && !event.altKey && !event.ctrlKey) {
    return MODIFIED_ENTER_SEQUENCES.shift;
  }

  if (event.altKey && !event.shiftKey && !event.ctrlKey) {
    return MODIFIED_ENTER_SEQUENCES.alt;
  }

  if (event.ctrlKey && !event.shiftKey && !event.altKey) {
    return MODIFIED_ENTER_SEQUENCES.ctrl;
  }

  return null;
}
