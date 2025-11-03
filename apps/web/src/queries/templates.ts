import { rpc } from "@/lib/rpc";
import { unwrapRpcResponse } from "@/lib/utils";
import type { TemplateSummary } from "@/types/template";

export const templateQueries = {
  all: () => ({
    queryKey: ["templates"] as const,
    queryFn: async (): Promise<TemplateSummary[]> => {
      const response = await rpc.api.templates.get();
      return unwrapRpcResponse<TemplateSummary[]>(
        response,
        "Failed to fetch templates"
      );
    },
  }),

  detail: (id: string) => ({
    queryKey: ["templates", id] as const,
    queryFn: async (): Promise<TemplateSummary> => {
      const response = await rpc.api.templates({ id }).get();
      return unwrapRpcResponse<TemplateSummary>(
        response,
        "Failed to fetch template"
      );
    },
  }),
};
