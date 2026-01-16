import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CellPhase } from "@/queries/cells";
import type { CellPlan } from "@/queries/plans";

const PLAN_MAX_LENGTH = 25_000;

type PlanPanelProps = {
  phase: CellPhase | null | undefined;
  plan: CellPlan | null;
  isReadOnly: boolean;
  isLoading: boolean;
  onSubmitPlan: (content: string) => Promise<void>;
  onRequestRevision: (feedback: string) => Promise<void>;
  onApprove: () => Promise<void>;
  isSubmitting: boolean;
  isRequestingRevision: boolean;
  isApproving: boolean;
};

type TextValidation = {
  value: string;
  error: string | null;
};

function validateText(value: string): TextValidation {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { value: trimmed, error: "Required" };
  }
  if (value.length > PLAN_MAX_LENGTH) {
    return { value: trimmed, error: "Too long" };
  }
  return { value: trimmed, error: null };
}

export function PlanPanel({
  phase,
  plan,
  isReadOnly,
  isLoading,
  onSubmitPlan,
  onRequestRevision,
  onApprove,
  isSubmitting,
  isRequestingRevision,
  isApproving,
}: PlanPanelProps) {
  const phaseValue = phase ?? "implementation";
  const visible = phaseValue === "planning" || phaseValue === "plan_review";

  const hasPlan = Boolean(plan?.content?.trim());
  const [draftPlanValue, setDraftPlanValue] = useState("");
  const [draftFeedbackValue, setDraftFeedbackValue] = useState("");

  const planCheck = useMemo(
    () => validateText(draftPlanValue),
    [draftPlanValue]
  );
  const feedbackCheck = useMemo(
    () => validateText(draftFeedbackValue),
    [draftFeedbackValue]
  );

  const approveDisabled = useMemo(
    () =>
      isReadOnly ||
      !hasPlan ||
      phaseValue !== "plan_review" ||
      isApproving ||
      isLoading,
    [isReadOnly, hasPlan, phaseValue, isApproving, isLoading]
  );

  const submitDisabled = useMemo(
    () => isReadOnly || isSubmitting || isLoading || Boolean(planCheck.error),
    [isReadOnly, isSubmitting, isLoading, planCheck.error]
  );

  const revisionDisabled = useMemo(
    () =>
      isReadOnly ||
      isRequestingRevision ||
      isLoading ||
      Boolean(feedbackCheck.error),
    [isReadOnly, isRequestingRevision, isLoading, feedbackCheck.error]
  );

  const statusCopy = useMemo(
    () =>
      phaseValue === "planning"
        ? "Submit a plan for review before implementation."
        : "Approve or request revisions on the submitted plan.",
    [phaseValue]
  );

  const handleApprove = useCallback(() => {
    onApprove().catch(() => null);
  }, [onApprove]);

  const handleSubmitPlan = useCallback(() => {
    if (planCheck.error) {
      return;
    }

    onSubmitPlan(planCheck.value)
      .then(() => setDraftPlanValue(""))
      .catch(() => null);
  }, [onSubmitPlan, planCheck.value, planCheck.error]);

  const handleRequestRevision = useCallback(() => {
    if (feedbackCheck.error) {
      return;
    }

    onRequestRevision(feedbackCheck.value)
      .then(() => setDraftFeedbackValue(""))
      .catch(() => null);
  }, [onRequestRevision, feedbackCheck.value, feedbackCheck.error]);

  const latestPlanContent = useMemo(() => {
    if (isLoading) {
      return (
        <p className="mt-2 text-muted-foreground text-sm">Loading plan...</p>
      );
    }

    if (hasPlan) {
      return (
        <pre className="mt-2 whitespace-pre-wrap break-words text-foreground text-sm">
          {plan?.content}
        </pre>
      );
    }

    return (
      <p className="mt-2 text-muted-foreground text-sm">
        No plan submitted yet.
      </p>
    );
  }, [isLoading, hasPlan, plan?.content]);

  const rightColumnContent = useMemo(() => {
    if (phaseValue === "planning") {
      return (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
              Plan
            </p>
            <Textarea
              className="mt-2 min-h-[180px]"
              disabled={isReadOnly || isSubmitting || isLoading}
              onChange={(event) => setDraftPlanValue(event.target.value)}
              placeholder="Write a structured plan: goals, constraints, steps, acceptance criteria..."
              value={draftPlanValue}
            />
            {planCheck.error ? (
              <p className="mt-2 text-destructive text-xs">{planCheck.error}</p>
            ) : null}
          </div>
          <Button
            disabled={submitDisabled}
            onClick={handleSubmitPlan}
            type="button"
          >
            {isSubmitting ? "Submitting..." : "Submit Plan"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
            Request Revisions
          </p>
          <Textarea
            className="mt-2 min-h-[180px]"
            disabled={isReadOnly || isRequestingRevision || isLoading}
            onChange={(event) => setDraftFeedbackValue(event.target.value)}
            placeholder="What needs to change before approval?"
            value={draftFeedbackValue}
          />
          {feedbackCheck.error ? (
            <p className="mt-2 text-destructive text-xs">
              {feedbackCheck.error}
            </p>
          ) : null}
        </div>
        <Button
          disabled={revisionDisabled}
          onClick={handleRequestRevision}
          type="button"
          variant="outline"
        >
          {isRequestingRevision ? "Sending..." : "Request Revisions"}
        </Button>
      </div>
    );
  }, [
    phaseValue,
    isReadOnly,
    isSubmitting,
    isLoading,
    draftPlanValue,
    planCheck.error,
    submitDisabled,
    handleSubmitPlan,
    isRequestingRevision,
    draftFeedbackValue,
    feedbackCheck.error,
    revisionDisabled,
    handleRequestRevision,
  ]);

  if (!visible) {
    return null;
  }

  return (
    <section className="border-border border-b bg-muted/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
            Plan Review
          </p>
          <p className="text-muted-foreground text-sm">{statusCopy}</p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={approveDisabled}
            onClick={handleApprove}
            type="button"
            variant="secondary"
          >
            {isApproving ? "Approving..." : "Approve"}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-sm border border-border bg-background p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
            Latest Plan
          </p>
          {latestPlanContent}
          {plan?.feedback ? (
            <div className="mt-3 border-border/60 border-t pt-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
                Feedback
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-foreground text-sm">
                {plan.feedback}
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-sm border border-border bg-background p-3">
          {rightColumnContent}
        </div>
      </div>
    </section>
  );
}
