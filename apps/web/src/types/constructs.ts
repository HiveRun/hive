// Shared types inferred from backend schemas
// This file should be kept in sync with backend TypeBox schemas

export type Construct = {
  id: string;
  name: string;
  description: string | null;
  templateId: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateConstructInput = {
  name: string;
  description?: string;
  templateId: string;
  branch?: string;
};

export type UpdateConstructInput = {
  name: string;
  description?: string;
  templateId: string;
};
