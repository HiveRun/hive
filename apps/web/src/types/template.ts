export type TemplateSummary = {
  id: string;
  label: string;
  summary: string;
  type: "implementation" | "planning" | "manual";
  servicesCount: number;
};
