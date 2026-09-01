import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const MICROPHONE_SCENARIO_NAME = /Browser microphone/;
const GUARDIAN_ROLE = /Publishes product identity, forwards I\/O/;
const HIVE_FOCUS_NODES = /Focus nodes · HIVE/;
const PLAYBACK_INTERVAL_MS = 1800;
let currentSearch: {
  fault?: boolean;
  returnStep?: number;
  scenario?:
    | "adb-isolation"
    | "cold-start"
    | "microphone"
    | "stale-recovery"
    | "viewer-restart";
  step?: number;
  tour?: "explore" | "guided";
} = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useNavigate: () => navigateMock,
    useSearch: () => currentSearch,
  }),
}));

import { AndroidRuntimeRoute, runtimeSearchSchema } from "./android-runtime";

describe("Android Runtime Lab route", () => {
  beforeEach(() => {
    currentSearch = { tour: "explore" };
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("validates shareable scenario state", () => {
    expect(
      runtimeSearchSchema.parse({
        fault: true,
        scenario: "stale-recovery",
        step: 3,
        tour: "guided",
      })
    ).toEqual({
      fault: true,
      scenario: "stale-recovery",
      step: 3,
      tour: "guided",
    });
    expect(() => runtimeSearchSchema.parse({ scenario: "unknown" })).toThrow();
    expect(() => runtimeSearchSchema.parse({ step: -1 })).toThrow();
  });

  it("opens with a mission briefing and starts the guided tour", () => {
    currentSearch = {};
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByRole("heading", {
        name: "Understand the Android runtime by watching it move",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("How the tour works")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start guided tour" }));

    expect(navigateMock).toHaveBeenLastCalledWith({
      search: { scenario: "cold-start", step: 0, tour: "guided" },
      to: "/android-runtime",
    });
  });

  it("advances guided checkpoints and preserves guided mode", () => {
    currentSearch = { scenario: "cold-start", step: 0, tour: "guided" };
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByText("Guided tour · Checkpoint 1 of 26")
    ).toBeInTheDocument();
    expect(screen.getByText(HIVE_FOCUS_NODES)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next checkpoint" }));

    expect(navigateMock).toHaveBeenLastCalledWith({
      search: { scenario: "cold-start", step: 1, tour: "guided" },
      to: "/android-runtime",
    });
  });

  it("returns a guided failure detour to its originating checkpoint", () => {
    currentSearch = {
      fault: true,
      returnStep: 4,
      scenario: "cold-start",
      step: 2,
      tour: "guided",
    };
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByRole("heading", {
        name: "Failure branch: Emulator never completes boot",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Guided tour progress" })
    ).toHaveAttribute("aria-valuenow", "3");
    fireEvent.click(screen.getByRole("button", { name: "Return to path" }));

    expect(navigateMock).toHaveBeenLastCalledWith({
      search: {
        fault: undefined,
        returnStep: undefined,
        scenario: "cold-start",
        step: 4,
        tour: "guided",
      },
      to: "/android-runtime",
    });
  });

  it("renders the default simulation without activating host resources", () => {
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByRole("heading", { name: "Android Runtime Lab" })
    ).toBeInTheDocument();
    expect(screen.getByText("no host resources")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Allocate service ports" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play scenario" })).toBeEnabled();
  });

  it("switches scenarios and injects their faults through URL state", () => {
    render(<AndroidRuntimeRoute />);

    fireEvent.click(
      screen.getByRole("button", { name: MICROPHONE_SCENARIO_NAME })
    );
    expect(navigateMock).toHaveBeenLastCalledWith({
      search: { scenario: "microphone", step: 0, tour: "explore" },
      to: "/android-runtime",
    });

    fireEvent.click(screen.getByRole("button", { name: "Boot timeout" }));
    expect(navigateMock).toHaveBeenLastCalledWith({
      search: {
        fault: true,
        returnStep: 0,
        scenario: "cold-start",
        step: 2,
        tour: "explore",
      },
      to: "/android-runtime",
    });
  });

  it("advances playback on the deterministic event interval", () => {
    vi.useFakeTimers();
    render(<AndroidRuntimeRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Play scenario" }));
    act(() => vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS));

    expect(navigateMock).toHaveBeenLastCalledWith({
      replace: true,
      search: {
        fault: undefined,
        scenario: "cold-start",
        step: 1,
        tour: "explore",
      },
      to: "/android-runtime",
    });
  });

  it("keeps a fault on its terminal branch and disables playback", () => {
    currentSearch = {
      fault: true,
      scenario: "cold-start",
      step: 999,
      tour: "explore",
    };
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Emulator never completes boot",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play scenario" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Android emulator, blocked" })
    ).toBeInTheDocument();
  });

  it("inspects topology nodes", () => {
    render(<AndroidRuntimeRoute />);

    fireEvent.click(
      screen.getByRole("button", { name: "Product guardian, standby" })
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Product guardian" })
    ).toBeInTheDocument();
    expect(screen.getByText(GUARDIAN_ROLE)).toBeInTheDocument();
  });

  it("clamps out-of-range URL steps before rendering", () => {
    currentSearch = {
      scenario: "viewer-restart",
      step: 999,
      tour: "explore",
    };
    render(<AndroidRuntimeRoute />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Reconnect client" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play scenario" })
    ).toBeDisabled();
  });
});
