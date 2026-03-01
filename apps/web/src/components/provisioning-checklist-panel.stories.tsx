import type { Meta, StoryObj } from "@storybook/react";
import { ProvisioningChecklistPanel } from "@/components/provisioning-checklist-panel";
import type { ProvisioningChecklist } from "@/lib/provisioning-checklist";

const baseChecklist: ProvisioningChecklist = {
  steps: [
    {
      key: "create_cell_record",
      label: "Create cell record",
      state: "done",
      durationMs: 31,
    },
    {
      key: "create_worktree",
      label: "Create workspace",
      state: "done",
      durationMs: 448,
    },
    {
      key: "ensure_services",
      label: "Run setup and start services",
      state: "active",
      detail: "Starting server and web services",
    },
    {
      key: "ensure_agent_session",
      label: "Prepare agent session",
      state: "pending",
    },
    {
      key: "mark_ready",
      label: "Finalize startup",
      state: "pending",
    },
  ],
  currentStep: "Ensure services",
  currentStepLabel: "Run setup and start services",
  currentStepDetail: "Starting server and web services",
  nextStepLabel: "Prepare agent session",
  completedCount: 2,
  remainingCount: 3,
  totalCount: 5,
  hasError: false,
};

const DEFAULT_DONE_DURATION_MS = 120;

const meta: Meta<typeof ProvisioningChecklistPanel> = {
  title: "Features/ProvisioningChecklistPanel",
  component: ProvisioningChecklistPanel,
  args: {
    checklist: baseChecklist,
    statusMessage: "Provisioning in progress",
    variant: "inline",
  },
  decorators: [
    (StoryComponent) => (
      <div className="max-w-2xl p-4">
        <StoryComponent />
      </div>
    ),
  ],
  tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};

export const Completed: Story = {
  args: {
    checklist: {
      ...baseChecklist,
      steps: baseChecklist.steps.map((step) => ({
        ...step,
        state: "done",
        detail: null,
        durationMs: step.durationMs ?? DEFAULT_DONE_DURATION_MS,
      })),
      currentStep: null,
      currentStepLabel: null,
      currentStepDetail: null,
      nextStepLabel: null,
      completedCount: 5,
      remainingCount: 0,
      hasError: false,
    },
    statusMessage: "Provisioning complete",
  },
};

export const Failed: Story = {
  args: {
    checklist: {
      ...baseChecklist,
      steps: baseChecklist.steps.map((step) =>
        step.key === "ensure_services"
          ? {
              ...step,
              state: "error",
              detail: "Setup script exited with code 1",
            }
          : step
      ),
      currentStep: "Ensure services",
      currentStepLabel: "Run setup and start services",
      currentStepDetail: "Setup script exited with code 1",
      nextStepLabel: null,
      hasError: true,
    },
    statusMessage: "Provisioning failed",
  },
};
