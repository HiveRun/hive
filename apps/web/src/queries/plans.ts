import { rpc } from "@/lib/rpc";
import { formatRpcError } from "@/lib/rpc-error";

export type CellPlan = {
  id: string;
  cellId: string;
  version: number;
  content: string;
  createdAt: string;
  feedback?: string | null;
};

export const planQueries = {
  latest: (cellId: string) => ({
    queryKey: ["cells", cellId, "plan", "latest"] as const,
    queryFn: async (): Promise<CellPlan | null> => {
      const { data, error } = await rpc.api.cells({ id: cellId }).plan.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load plan"));
      }
      return (data.plan as CellPlan | null) ?? null;
    },
  }),

  versions: (cellId: string) => ({
    queryKey: ["cells", cellId, "plan", "versions"] as const,
    queryFn: async (): Promise<CellPlan[]> => {
      const { data, error } = await rpc.api
        .cells({ id: cellId })
        .plan.versions.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load plan versions"));
      }
      return (data.plans as CellPlan[]) ?? [];
    },
  }),
};

export const planMutations = {
  submit: {
    mutationFn: async (input: { cellId: string; content: string }) => {
      const { data, error } = await rpc.api
        .cells({ id: input.cellId })
        .plan.submit.post({
          content: input.content,
        });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to submit plan"));
      }
      return data.plan as CellPlan;
    },
  },

  requestRevision: {
    mutationFn: async (input: { cellId: string; feedback: string }) => {
      const { data, error } = await rpc.api
        .cells({ id: input.cellId })
        .plan["request-revision"].post({
          feedback: input.feedback,
        });
      if (error) {
        throw new Error(formatRpcError(error, "Failed to request revisions"));
      }
      return data.plan as CellPlan;
    },
  },

  approve: {
    mutationFn: async (input: { cellId: string }) => {
      const { data, error } = await rpc.api
        .cells({ id: input.cellId })
        .plan.approve.post();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to approve plan"));
      }
      return data as { message: string };
    },
  },
};
