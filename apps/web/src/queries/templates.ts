import { rpc } from "@/lib/rpc";

export type Template = {
  id: string;
  label: string;
  type: string;
  configJson: unknown;
};

export const templateQueries = {
  all: () => ({
    queryKey: ["templates"] as const,
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await rpc.api.templates.get();
      if (error) {
        throw new Error("Failed to fetch templates");
      }
      if (!(data && Array.isArray(data.templates))) {
        throw new Error("Invalid templates response from server");
      }
      return data.templates;
    },
  }),

  detail: (id: string) => ({
    queryKey: ["templates", id] as const,
    queryFn: async (): Promise<Template> => {
      const { data, error } = await rpc.api.templates({ id }).get();
      if (error) {
        throw new Error("Template not found");
      }
      return data;
    },
  }),
};
