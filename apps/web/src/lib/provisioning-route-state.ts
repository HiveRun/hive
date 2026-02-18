const ACTIVE_PROVISIONING_STATUSES = new Set(["spawning", "pending"]);

export function shouldPollProvisioningStatus(
  status: string | undefined
): boolean {
  return typeof status === "string" && ACTIVE_PROVISIONING_STATUSES.has(status);
}

export function shouldStreamProvisioningTimeline(args: {
  hasCell: boolean;
  status: string | undefined;
}): boolean {
  return args.hasCell && args.status !== "ready";
}

export function resolveProvisioningStatusMessage(
  status: string | undefined
): string {
  if (status === "error") {
    return "Provisioning failed";
  }
  if (status === "pending") {
    return "Preparing agent session";
  }
  if (status === "spawning") {
    return "Provisioning workspace and services";
  }

  return "Waiting for provisioning status update";
}
