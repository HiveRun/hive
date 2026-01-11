import { treaty } from "@elysiajs/eden";
import type { App } from "@hive/server";
import { getApiBase } from "@/lib/api-base";

const API_URL = getApiBase();

export const rpc = treaty<App>(API_URL);

// Helper types for convenience - inferred from Eden Treaty
export type CreateCellInput = Parameters<typeof rpc.api.cells.post>[0];
