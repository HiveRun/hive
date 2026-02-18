import type { CellTimingStep } from "@/queries/cells";

export type ProvisioningChecklistStepKey =
  | "create_cell_record"
  | "create_worktree"
  | "ensure_services"
  | "ensure_agent_session"
  | "mark_ready";

export type ProvisioningChecklistStepState =
  | "done"
  | "active"
  | "pending"
  | "error";

export type ProvisioningChecklistStep = {
  key: ProvisioningChecklistStepKey;
  label: string;
  state: ProvisioningChecklistStepState;
  durationMs?: number;
  detail?: string | null;
};

export type ProvisioningChecklist = {
  steps: ProvisioningChecklistStep[];
  currentStep: string | null;
  currentStepLabel: string | null;
  currentStepDetail: string | null;
  nextStepLabel: string | null;
  completedCount: number;
  remainingCount: number;
  totalCount: number;
  hasError: boolean;
};

type ProvisioningTimingStep = Pick<
  CellTimingStep,
  "step" | "status" | "durationMs" | "createdAt"
>;

const CHECKLIST_STEPS: Array<{
  key: ProvisioningChecklistStepKey;
  label: string;
}> = [
  { key: "create_cell_record", label: "Create cell record" },
  { key: "create_worktree", label: "Create workspace" },
  { key: "ensure_services", label: "Run setup and start services" },
  { key: "ensure_agent_session", label: "Prepare agent session" },
  { key: "mark_ready", label: "Finalize startup" },
];

const CHECKLIST_STEP_EXACT_MATCHES: Array<{
  key: ProvisioningChecklistStepKey;
  matches: readonly string[];
}> = [
  {
    key: "create_cell_record",
    matches: [
      "create_cell_record",
      "insert_cell_record",
      "insert_provisioning_state",
      "create_request_received",
    ],
  },
  {
    key: "ensure_agent_session",
    matches: ["ensure_agent_session", "send_initial_prompt"],
  },
  {
    key: "mark_ready",
    matches: ["mark_ready"],
  },
];

const CHECKLIST_STEP_PREFIX_MATCHES: Array<{
  key: ProvisioningChecklistStepKey;
  prefix: string;
}> = [
  { key: "create_worktree", prefix: "create_worktree" },
  { key: "ensure_services", prefix: "ensure_services" },
];

const MULTI_SPACE_RE = /\s+/g;
const LEADING_COLONS_RE = /^:+/;

export function buildProvisioningChecklist(args: {
  cellStatus: string | undefined;
  steps: ProvisioningTimingStep[];
}): ProvisioningChecklist {
  const latestFirstSteps = [...args.steps].sort(
    (left, right) =>
      toTimingTimestamp(right.createdAt) - toTimingTimestamp(left.createdAt)
  );

  const exactStepByName = new Map<string, ProvisioningTimingStep>();
  const latestStepByKey = new Map<
    ProvisioningChecklistStepKey,
    ProvisioningTimingStep
  >();

  for (const step of latestFirstSteps) {
    if (!exactStepByName.has(step.step)) {
      exactStepByName.set(step.step, step);
    }

    const normalizedKey = normalizeChecklistStepKey(step.step);
    if (normalizedKey && !latestStepByKey.has(normalizedKey)) {
      latestStepByKey.set(normalizedKey, step);
    }
  }

  const latestActionStep = latestFirstSteps.find(
    (step) => step.step !== "total" && step.step !== "create_request_received"
  );

  const currentKey = latestActionStep
    ? normalizeChecklistStepKey(latestActionStep.step)
    : null;
  const errorKey =
    latestActionStep?.status === "error" && currentKey ? currentKey : null;

  const isDone = (key: ProvisioningChecklistStepKey) => {
    if (key === "mark_ready") {
      return (
        args.cellStatus === "ready" ||
        exactStepByName.get("mark_ready")?.status === "ok"
      );
    }

    return exactStepByName.get(key)?.status === "ok";
  };

  const checklistSteps = CHECKLIST_STEPS.map((definition) => {
    let state: ProvisioningChecklistStepState = "pending";
    if (errorKey === definition.key) {
      state = "error";
    } else if (isDone(definition.key)) {
      state = "done";
    } else if (currentKey === definition.key) {
      state = "active";
    }

    const exact = exactStepByName.get(definition.key);
    const latestForKey = latestStepByKey.get(definition.key);
    const detail = getChecklistDetail({
      key: definition.key,
      state,
      latestActionStep,
      latestForKey,
    });

    return {
      key: definition.key,
      label: definition.label,
      state,
      durationMs: exact?.durationMs,
      detail,
    } satisfies ProvisioningChecklistStep;
  });

  const completedCount = checklistSteps.filter(
    (step) => step.state === "done"
  ).length;
  const totalCount = checklistSteps.length;
  const remainingCount = Math.max(0, totalCount - completedCount);

  return {
    steps: checklistSteps,
    currentStep: latestActionStep
      ? formatProvisioningStepName(latestActionStep.step)
      : null,
    currentStepLabel: currentKey
      ? (CHECKLIST_STEPS.find((step) => step.key === currentKey)?.label ?? null)
      : null,
    currentStepDetail: latestActionStep
      ? extractStepDetail(latestActionStep.step)
      : null,
    nextStepLabel:
      checklistSteps.find((step) => step.state === "pending")?.label ?? null,
    completedCount,
    remainingCount,
    totalCount,
    hasError: Boolean(errorKey),
  };
}

function getChecklistDetail(args: {
  key: ProvisioningChecklistStepKey;
  state: ProvisioningChecklistStepState;
  latestActionStep: ProvisioningTimingStep | undefined;
  latestForKey: ProvisioningTimingStep | undefined;
}): string | null {
  const { key, state, latestActionStep, latestForKey } = args;

  if (state === "done") {
    return null;
  }

  if (state === "pending") {
    return null;
  }

  if (
    (state === "active" || state === "error") &&
    latestActionStep &&
    normalizeChecklistStepKey(latestActionStep.step) === key
  ) {
    return extractStepDetail(latestActionStep.step);
  }

  if (latestForKey?.step && latestForKey.step !== key) {
    return extractStepDetail(latestForKey.step);
  }

  return null;
}

export function toTimingTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  if (typeof value === "string" || typeof value === "number") {
    const milliseconds = new Date(value).getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  return 0;
}

function normalizeChecklistStepKey(
  step: string
): ProvisioningChecklistStepKey | null {
  for (const matcher of CHECKLIST_STEP_EXACT_MATCHES) {
    if (matcher.matches.includes(step)) {
      return matcher.key;
    }
  }

  for (const matcher of CHECKLIST_STEP_PREFIX_MATCHES) {
    if (step.startsWith(matcher.prefix)) {
      return matcher.key;
    }
  }

  return null;
}

function extractStepDetail(step: string): string | null {
  const normalized = normalizeChecklistStepKey(step);
  if (!normalized) {
    return formatProvisioningStepName(step);
  }

  if (step === normalized) {
    return null;
  }

  const detail = step
    .slice(normalized.length)
    .replace(LEADING_COLONS_RE, "")
    .trim();
  if (detail.length === 0) {
    return null;
  }

  return formatProvisioningStepName(detail);
}

function formatProvisioningStepName(step: string): string {
  return step
    .replaceAll(":", " > ")
    .replaceAll("_", " ")
    .replace(MULTI_SPACE_RE, " ")
    .trim();
}
