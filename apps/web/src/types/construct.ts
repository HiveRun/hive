export type ConstructStatus =
  | "draft"
  | "provisioning"
  | "active"
  | "awaiting_input"
  | "reviewing"
  | "completed"
  | "parked"
  | "archived"
  | "error";

export type ConstructType = "implementation" | "planning" | "manual";

export type Construct = {
  id: string;
  templateId: string;
  name: string;
  description: string | null;
  type: ConstructType;
  status: ConstructStatus;
  workspacePath: string | null;
  constructPath: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
  metadata: unknown;
};
