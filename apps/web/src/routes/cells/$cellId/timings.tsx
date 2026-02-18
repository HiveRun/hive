import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const MAX_TIMINGS_LIMIT = 1000;

const cellTimingsSearchSchema = z.object({
  workflow: z.enum(["all", "create", "delete"]).optional(),
  runId: z.string().optional(),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TIMINGS_LIMIT).optional(),
});

export const Route = createFileRoute("/cells/$cellId/timings")({
  validateSearch: (search) => cellTimingsSearchSchema.parse(search),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/global-timings",
      search: {
        ...search,
        cellId: params.cellId,
      },
      replace: true,
    });
  },
});
