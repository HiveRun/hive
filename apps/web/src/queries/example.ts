import { rpc } from "@/lib/rpc";

export const exampleQueries = {
  /**
   * Get example data from the API
   */
  get: () => ({
    queryKey: ["example"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.example.get();

      if (error) {
        throw new Error("Failed to fetch example data");
      }

      return data;
    },
  }),
};
