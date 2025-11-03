import { rpc } from "@/lib/rpc";

export const serviceQueries = {
  byConstruct: (constructId: string) => ({
    queryKey: ["services", "construct", constructId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.services
        .construct({ constructId })
        .get();
      if (error) {
        throw new Error("Failed to fetch services");
      }
      return data;
    },
  }),

  detail: (serviceId: string) => ({
    queryKey: ["services", serviceId] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.services({ serviceId }).get();
      if (error) {
        throw new Error("Failed to fetch service");
      }
      return data;
    },
  }),

  info: (serviceId: string) => ({
    queryKey: ["services", serviceId, "info"] as const,
    queryFn: async () => {
      const { data, error } = await rpc.api.services({ serviceId }).info.get();
      if (error) {
        throw new Error("Failed to fetch service info");
      }
      return data;
    },
  }),
};

export const serviceMutations = {
  start: {
    mutationFn: async (serviceId: string) => {
      const { data, error } = await rpc.api
        .services({ serviceId })
        .start.post();
      if (error) {
        throw new Error("Failed to start service");
      }
      return data;
    },
  },

  stop: {
    mutationFn: async (serviceId: string) => {
      const { data, error } = await rpc.api.services({ serviceId }).stop.post();
      if (error) {
        throw new Error("Failed to stop service");
      }
      return data;
    },
  },

  restart: {
    mutationFn: async (serviceId: string) => {
      const { data, error } = await rpc.api
        .services({ serviceId })
        .restart.post();
      if (error) {
        throw new Error("Failed to restart service");
      }
      return data;
    },
  },

  checkAll: {
    mutationFn: async () => {
      const { data, error } = await rpc.api.services["check-all"].post();
      if (error) {
        throw new Error("Failed to check services");
      }
      return data;
    },
  },
};
