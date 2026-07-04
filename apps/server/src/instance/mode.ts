import { resolve, sep } from "node:path";

export type HiveInstanceMode = "local" | "private-remote";

const PRIVATE_REMOTE_ACK_VALUE = "private-network-only";

const splitConfiguredList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const normalizeHiveInstanceMode = (
  value: string | undefined
): HiveInstanceMode =>
  value === "private-remote" || value === "shared" ? "private-remote" : "local";

const resolveHiveInstanceMode = () =>
  normalizeHiveInstanceMode(process.env.HIVE_INSTANCE_MODE);

export const isPrivateRemoteInstance = () =>
  resolveHiveInstanceMode() === "private-remote";

export const assertPrivateRemoteAccessAcknowledged = () => {
  if (!isPrivateRemoteInstance()) {
    return;
  }

  if (process.env.HIVE_REMOTE_ACCESS_ACK === PRIVATE_REMOTE_ACK_VALUE) {
    return;
  }

  throw new Error(
    `HIVE_INSTANCE_MODE=private-remote requires HIVE_REMOTE_ACCESS_ACK=${PRIVATE_REMOTE_ACK_VALUE}. Hive has no built-in auth in this mode; expose it only through Cloudflare Access, Tailscale, VPN, or equivalent private controls.`
  );
};

export const privateRemoteAccessWarning = () =>
  "WARNING: Hive private-remote mode has no built-in authentication. Only expose this instance through Cloudflare Access, Tailscale, VPN, or equivalent private network controls.";

const resolveAllowedWorkspaceRoots = () =>
  splitConfiguredList(process.env.HIVE_ALLOWED_WORKSPACE_ROOTS).map((root) =>
    resolve(root)
  );

export const isWorkspacePathAllowed = (path: string) => {
  if (!isPrivateRemoteInstance()) {
    return true;
  }

  const roots = resolveAllowedWorkspaceRoots();
  if (roots.length === 0) {
    return false;
  }

  const normalizedPath = resolve(path);
  return roots.some(
    (root) =>
      normalizedPath === root || normalizedPath.startsWith(`${root}${sep}`)
  );
};

export const assertWorkspacePathAllowed = (path: string) => {
  if (isWorkspacePathAllowed(path)) {
    return;
  }

  const roots = resolveAllowedWorkspaceRoots();
  throw new Error(
    roots.length === 0
      ? "Remote workspace access requires HIVE_ALLOWED_WORKSPACE_ROOTS"
      : `Workspace path is outside allowed remote roots: ${path}`
  );
};
