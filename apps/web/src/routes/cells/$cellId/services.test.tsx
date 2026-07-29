import {
  cleanup as cleanupRenderedServices,
  fireEvent as fireServiceEvent,
  render as renderServicesPanel,
  screen as serviceScreen,
  waitFor as waitForServiceUi,
  within as withinServiceElement,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellServiceSummary } from "@/queries/cells";

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));

vi.mock("@/components/pty-stream-terminal", () => ({
  PtyStreamTerminal: () => <div>Service terminal</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ServicesPanel } from "./services";

const buildService = (
  overrides: Partial<CellServiceSummary> = {}
): CellServiceSummary =>
  ({
    command: "bun run dev",
    cwd: "/tmp/hive-cell",
    env: {},
    hasMoreLogs: false,
    id: "service-api",
    lastKnownError: null,
    logPath: null,
    name: "api",
    ports: [],
    recentLogs: null,
    status: "running",
    totalLogLines: 0,
    type: "process",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  }) as CellServiceSummary;

const renderServices = (services: CellServiceSummary[]) =>
  renderServicesPanel(
    <ServicesPanel
      cellId="cell-1"
      isBulkActionPending={false}
      isLoading={false}
      isStartingAll={false}
      isStoppingAll={false}
      onStartAll={vi.fn()}
      onStartService={vi.fn()}
      onStopAll={vi.fn()}
      onStopService={vi.fn()}
      services={services}
    />
  );

const renderLegacyService = (options: {
  port: number;
  portReachable: boolean;
  url: string;
}) => {
  const { ports: _ports, ...legacyService } = buildService(options);
  renderServices([legacyService as unknown as CellServiceSummary]);
  return serviceScreen.getByRole("combobox");
};

describe("service port presentation", () => {
  beforeEach(() => {
    clipboardWriteText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(cleanupRenderedServices);

  it("renders every named port while the selector summarizes only the primary", async () => {
    renderServices([
      buildService({
        port: 43_101,
        portReachable: true,
        ports: [
          {
            name: "http",
            port: 43_101,
            primary: true,
            protocol: "http",
            url: "http://localhost:43101",
            portReachable: true,
          },
          {
            name: "metrics",
            port: 43_102,
            primary: false,
            protocol: "tcp",
            portReachable: false,
          },
        ],
        url: "http://localhost:43101",
      }),
    ]);

    const selector = serviceScreen.getByRole("combobox");
    await waitForServiceUi(() => {
      expect(selector).toHaveTextContent("Primary port: 43101");
    });
    expect(
      withinServiceElement(selector).queryByText("43102")
    ).not.toBeInTheDocument();

    expect(serviceScreen.getAllByText("http")).toHaveLength(2);
    expect(serviceScreen.getByText("metrics")).toBeInTheDocument();
    expect(serviceScreen.getByText("tcp")).toBeInTheDocument();
    expect(serviceScreen.getByText("Primary")).toBeInTheDocument();
    expect(serviceScreen.getByText("Reachable")).toBeInTheDocument();
    expect(serviceScreen.getByText("Unreachable")).toBeInTheDocument();
    expect(
      serviceScreen.getByRole("button", { name: "Copy http port" })
    ).toBeInTheDocument();
    expect(
      serviceScreen.getByRole("button", { name: "Copy http URL" })
    ).toBeInTheDocument();
    expect(
      serviceScreen.queryByRole("button", { name: "Copy metrics URL" })
    ).not.toBeInTheDocument();

    fireServiceEvent.click(
      serviceScreen.getByRole("button", { name: "Copy http URL" })
    );
    await waitForServiceUi(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("http://localhost:43101");
    });
  });

  it("falls back to the legacy scalar port and URL", async () => {
    const selector = renderLegacyService({
      port: 3000,
      portReachable: false,
      url: "http://localhost:3000",
    });

    await waitForServiceUi(() => {
      expect(selector).toHaveTextContent("Primary port: 3000");
    });
    expect(serviceScreen.getByText("default")).toBeInTheDocument();
    expect(serviceScreen.getByText("Primary")).toBeInTheDocument();
    expect(serviceScreen.getByText("Unreachable")).toBeInTheDocument();
    expect(
      serviceScreen.getByText("http://localhost:3000")
    ).toBeInTheDocument();
    expect(
      serviceScreen.getByRole("button", { name: "Copy default port" })
    ).toBeInTheDocument();
    expect(
      serviceScreen.getByRole("button", { name: "Copy default URL" })
    ).toBeInTheDocument();
  });

  it("derives HTTPS for a legacy scalar URL", async () => {
    const selector = renderLegacyService({
      port: 9443,
      portReachable: true,
      url: "https://localhost:9443",
    });

    await waitForServiceUi(() => {
      expect(selector).toHaveTextContent("Primary port: 9443");
    });
    expect(serviceScreen.getByText("https")).toBeInTheDocument();
    expect(
      serviceScreen.getByText("https://localhost:9443")
    ).toBeInTheDocument();
  });
});
