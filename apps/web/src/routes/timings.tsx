import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const MAX_TIMINGS_LIMIT = 1000;

const legacyTimingsSearchSchema = z.object({
  workflow: z.enum(["all", "create", "delete"]).optional(),
  runId: z.string().optional(),
  cellId: z.string().optional(),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TIMINGS_LIMIT).optional(),
});

export const Route = createFileRoute("/timings")({
  validateSearch: (search) => legacyTimingsSearchSchema.parse(search),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/global-timings",
      search,
      replace: true,
    });
  },
});
