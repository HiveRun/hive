import { edenFetch } from "@elysiajs/eden";
import { tool } from "@opencode-ai/plugin";
import type { App } from "../../apps/server/src/server";

type HiveSubmitPlanArgs = {
  cellId: string;
  content: string;
};

const resolveHiveBaseUrl = () => {
  const explicit = process.env.HIVE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
};

export const hive_submit_plan = tool({
  description: "Submit a plan for a Hive cell (planning -> plan_review).",
  args: {
    cellId: tool.schema.string().min(1),
    content: tool.schema.string().min(1),
  },
  execute: async ({ cellId, content }: HiveSubmitPlanArgs) => {
    const baseUrl = resolveHiveBaseUrl();
    const api = edenFetch<App>(baseUrl);

    const result = await api("/api/cells/:id/plan/submit", {
      method: "POST",
      params: { id: cellId },
      body: { content },
    });

    if (result.error) {
      const message =
        result.error.value &&
        typeof result.error.value === "object" &&
        "message" in result.error.value
          ? String((result.error.value as { message?: unknown }).message)
          : "Failed to submit plan";

      throw new Error(message);
    }

    return `Submitted plan version ${result.data.plan?.version ?? "?"} for review.`;
  },
});
