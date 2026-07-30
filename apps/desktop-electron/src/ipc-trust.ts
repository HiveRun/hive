export const isTrustedIpcSender = <T extends object>(
  activeContents: T | null,
  sender: T,
  isTrusted: (contents: T) => boolean
) => activeContents === sender && isTrusted(sender);
