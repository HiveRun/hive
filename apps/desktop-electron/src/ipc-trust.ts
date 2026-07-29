export function isTrustedIpcSender<T extends object>(options: {
  activeContents: T | null;
  isTrusted: (contents: T) => boolean;
  sender: T;
}) {
  return (
    options.activeContents === options.sender &&
    options.isTrusted(options.sender)
  );
}
