const ACTIVE_PROVISIONING_STATUSES = new Set(["provisioning"]);

export function shouldPollProvisioningStatus(
  status: string | undefined
): boolean {
  return typeof status === "string" && ACTIVE_PROVISIONING_STATUSES.has(status);
}

export function shouldStreamProvisioningTimeline(args: {
  hasCell: boolean;
  status: string | undefined;
}): boolean {
  return (
    args.hasCell && (args.status === "provisioning" || args.status === "error")
  );
}

export function resolveProvisioningStatusMessage(
  status: string | undefined
): string {
  if (status === "error") {
    return "Provisioning failed";
  }
  if (status === "provisioning") {
    return "Provisioning workspace, services, and agent session";
  }
  if (status === "stopped") {
    return "Runtime stopped";
  }

  return "Waiting for provisioning status update";
}
