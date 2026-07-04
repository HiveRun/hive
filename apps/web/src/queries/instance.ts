import { getApiBase } from "@/lib/api-base";
import { rpc } from "@/lib/rpc";
import { formatRpcError } from "@/lib/rpc-error";

export const instanceQueries = {
  detail: () => ({
    queryKey: ["instance", getApiBase(), "detail"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.instance.get();
      if (error) {
        throw new Error(formatRpcError(error, "Failed to load instance"));
      }
      return data;
    },
  }),

  overview: () => ({
    queryKey: ["instance", getApiBase(), "overview"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.instance.overview.get();
      if (error) {
        throw new Error(
          formatRpcError(error, "Failed to load instance overview")
        );
      }
      return data;
    },
  }),
};

export type InstanceOverview = Awaited<
  ReturnType<ReturnType<typeof instanceQueries.overview>["queryFn"]>
>;
