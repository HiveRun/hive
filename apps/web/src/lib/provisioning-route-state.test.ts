import { describe, expect, it } from "vitest";
import {
  resolveProvisioningStatusMessage,
  shouldPollProvisioningStatus,
  shouldStreamProvisioningTimeline,
} from "./provisioning-route-state";

describe("provisioning-route-state", () => {
  it.each([
    { status: "provisioning", expected: true },
    { status: "ready", expected: false },
    { status: "stopped", expected: false },
    { status: "error", expected: false },
    { status: undefined, expected: false },
  ])("polling for $status", ({ status, expected }) => {
    expect(shouldPollProvisioningStatus(status)).toBe(expected);
  });

  it.each([
    { hasCell: true, status: "provisioning", expected: true },
    { hasCell: true, status: "error", expected: true },
    { hasCell: true, status: "ready", expected: false },
    { hasCell: true, status: "stopped", expected: false },
    { hasCell: false, status: "provisioning", expected: false },
  ])(
    "timeline streaming for hasCell=$hasCell status=$status",
    ({ hasCell, status, expected }) => {
      expect(shouldStreamProvisioningTimeline({ hasCell, status })).toBe(
        expected
      );
    }
  );

  it.each([
    { status: "error", expected: "Provisioning failed" },
    {
      status: "provisioning",
      expected: "Provisioning workspace, services, and agent session",
    },
    { status: "stopped", expected: "Runtime stopped" },
    { status: undefined, expected: "Waiting for provisioning status update" },
  ])("status copy for $status", ({ status, expected }) => {
    expect(resolveProvisioningStatusMessage(status)).toBe(expected);
  });
});
