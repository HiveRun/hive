import { treaty } from "@elysiajs/eden";
import type { App } from "@synthetic/server";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const rpc = treaty<App>(API_URL);
