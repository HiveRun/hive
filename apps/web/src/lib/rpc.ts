import { treaty } from "@elysiajs/eden";
import type { App } from "@synthetic/server";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const rpc = treaty<App>(API_URL);

// Helper types for convenience - inferred from Eden Treaty
export type CreateConstructInput = Parameters<
  typeof rpc.api.constructs.post
>[0];
export type UpdateConstructInput = Parameters<
  ReturnType<typeof rpc.api.constructs>["put"]
>[0];
