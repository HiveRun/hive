import { describe, expect, it } from "vitest";
import {
  resolveProvisioningStatusMessage,
  shouldPollProvisioningStatus,
  shouldStreamProvisioningTimeline,
} from "./provisioning-route-state";

describe("provisioning-route-state", () => {
  it.each([
    { status: "spawning", expected: true },
    { status: "pending", expected: true },
    { status: "ready", expected: false },
    { status: "error", expected: false },
    { status: undefined, expected: false },
  ])("polling for $status", ({ status, expected }) => {
    expect(shouldPollProvisioningStatus(status)).toBe(expected);
  });

  it.each([
    { hasCell: true, status: "spawning", expected: true },
    { hasCell: true, status: "pending", expected: true },
    { hasCell: true, status: "error", expected: true },
    { hasCell: true, status: "ready", expected: false },
    { hasCell: false, status: "spawning", expected: false },
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
    { status: "pending", expected: "Preparing agent session" },
    { status: "spawning", expected: "Provisioning workspace and services" },
    { status: undefined, expected: "Waiting for provisioning status update" },
  ])("status copy for $status", ({ status, expected }) => {
    expect(resolveProvisioningStatusMessage(status)).toBe(expected);
  });
});
