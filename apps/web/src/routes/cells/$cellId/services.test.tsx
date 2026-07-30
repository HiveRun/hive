import {
  cleanup as cleanupDom,
  screen as page,
  render as renderUi,
  waitFor as waitUntil,
  within as withinElement,
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
  renderUi(
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

describe("service port presentation", () => {
  beforeEach(() => {
    clipboardWriteText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(cleanupDom);

  it("renders every named port while the selector summarizes only the primary", async () => {
    renderServices([
      buildService({
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
      }),
    ]);

    const selector = page.getByRole("combobox");
    await waitUntil(() => {
      expect(selector).toHaveTextContent("Primary port: 43101");
    });
    expect(
      withinElement(selector).queryByText("43102")
    ).not.toBeInTheDocument();

    expect(page.getAllByText("http")).toHaveLength(2);
    expect(page.getByText("metrics")).toBeInTheDocument();
    expect(page.getByText("tcp")).toBeInTheDocument();
    expect(page.getByText("Primary")).toBeInTheDocument();
    expect(page.getByText("Reachable")).toBeInTheDocument();
    expect(page.getByText("Unreachable")).toBeInTheDocument();
    expect(
      page.getByRole("button", { name: "Copy http port" })
    ).toBeInTheDocument();
    expect(
      page.getByRole("button", { name: "Copy http URL" })
    ).toBeInTheDocument();
    expect(
      page.queryByRole("button", { name: "Copy metrics URL" })
    ).not.toBeInTheDocument();

    page.getByRole("button", { name: "Copy http URL" }).click();
    await waitUntil(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("http://localhost:43101");
    });
  });
});
