import { describe, expect, it } from "vitest";
import { buildProvisioningChecklist } from "./provisioning-checklist";

const BASE_TIME = "2026-02-17T17:00:00.000Z";
const WORKTREE_DURATION_MS = 345;
const SERVICES_ERROR_DURATION_MS = 2301;
const SERVICES_CURRENT_DURATION_MS = 100;
const WORKTREE_DONE_DURATION_MS = 300;
const CELL_RECORD_DURATION_MS = 10;

describe("buildProvisioningChecklist", () => {
  it("does not show stale sub-step detail for completed phases", () => {
    const checklist = buildProvisioningChecklist({
      cellStatus: "error",
      steps: [
        {
          step: "create_worktree:include_copy_files_start",
          status: "ok",
          durationMs: 0,
          createdAt: BASE_TIME,
        },
        {
          step: "create_worktree",
          status: "ok",
          durationMs: WORKTREE_DURATION_MS,
          createdAt: BASE_TIME,
        },
        {
          step: "ensure_services",
          status: "error",
          durationMs: SERVICES_ERROR_DURATION_MS,
          createdAt: "2026-02-17T17:00:01.000Z",
        },
      ],
    });

    const createWorkspaceStep = checklist.steps.find(
      (step) => step.key === "create_worktree"
    );

    expect(createWorkspaceStep?.state).toBe("done");
    expect(createWorkspaceStep?.durationMs).toBe(WORKTREE_DURATION_MS);
    expect(createWorkspaceStep?.detail).toBeNull();
  });

  it("uses the latest action step for current phase", () => {
    const checklist = buildProvisioningChecklist({
      cellStatus: "error",
      steps: [
        {
          step: "ensure_services",
          status: "error",
          durationMs: SERVICES_CURRENT_DURATION_MS,
          createdAt: "2026-02-17T17:00:02.000Z",
        },
        {
          step: "create_worktree",
          status: "ok",
          durationMs: WORKTREE_DONE_DURATION_MS,
          createdAt: "2026-02-17T17:00:01.000Z",
        },
        {
          step: "create_cell_record",
          status: "ok",
          durationMs: CELL_RECORD_DURATION_MS,
          createdAt: BASE_TIME,
        },
      ],
    });

    expect(checklist.currentStep).toBe("ensure services");
    expect(checklist.currentStepLabel).toBe("Run setup and start services");
    expect(checklist.hasError).toBe(true);
  });
});
