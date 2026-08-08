import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellServiceSummary } from "@/queries/cells";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/pty-stream-terminal", () => ({
  PtyStreamTerminal: ({ title }: { title: string }) => <div>{title}</div>,
}));

import { ProvisioningServiceActivity } from "./provisioning";

afterEach(cleanup);

describe("ProvisioningServiceActivity", () => {
  it("shows the live terminal for a starting service", () => {
    render(
      <ProvisioningServiceActivity
        cellId="cell-1"
        isLoading={false}
        services={[
          {
            id: "service-calibrate",
            name: "calibrate-dev",
            processAlive: true,
            status: "starting",
          } as CellServiceSummary,
        ]}
      />
    );

    expect(
      screen.getByText("calibrate-dev startup output")
    ).toBeInTheDocument();
  });

  it("shows supervisor activity before a service process exists", () => {
    render(
      <ProvisioningServiceActivity
        cellId="cell-1"
        isLoading={false}
        services={[]}
      />
    );

    expect(screen.getByText("Live startup output")).toBeInTheDocument();
    expect(screen.getByText("Preparing service process")).toBeInTheDocument();
  });
});
