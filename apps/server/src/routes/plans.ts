import { and, desc, eq, max } from "drizzle-orm";
import { Elysia, type Static, t } from "elysia";

import { AgentRuntimeServiceTag } from "../agents/service";
import { DatabaseService } from "../db";
import { runServerEffect } from "../runtime";
import {
  CellPlanResponseSchema,
  CellPlanVersionsResponseSchema,
  RequestPlanRevisionSchema,
  SubmitCellPlanSchema,
} from "../schema/api";
import { cellPlans } from "../schema/cell-plans";
import { cells } from "../schema/cells";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

const toPlanResponse = (row: typeof cellPlans.$inferSelect) => ({
  id: row.id,
  cellId: row.cellId,
  version: row.version,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
  feedback: row.feedback,
});

export const cellPlansRoutes = new Elysia({ prefix: "/api/cells" }).group(
  "/:id/plan",
  (app) =>
    app
      .get(
        "/",
        async ({ params, set }) => {
          const { db } = await runServerEffect(DatabaseService);
          const [cell] = await db
            .select()
            .from(cells)
            .where(eq(cells.id, params.id));
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          const [latest] = await db
            .select()
            .from(cellPlans)
            .where(eq(cellPlans.cellId, params.id))
            .orderBy(desc(cellPlans.version))
            .limit(1);

          return {
            plan: latest ? toPlanResponse(latest) : null,
          } satisfies Static<typeof CellPlanResponseSchema>;
        },
        {
          params: t.Object({ id: t.String() }),
          response: {
            200: CellPlanResponseSchema,
            404: t.Object({ message: t.String() }),
          },
        }
      )
      .get(
        "/versions",
        async ({ params, set }) => {
          const { db } = await runServerEffect(DatabaseService);
          const [cell] = await db
            .select()
            .from(cells)
            .where(eq(cells.id, params.id));
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          const rows = await db
            .select()
            .from(cellPlans)
            .where(eq(cellPlans.cellId, params.id))
            .orderBy(desc(cellPlans.version));

          return {
            plans: rows.map(toPlanResponse),
          } satisfies Static<typeof CellPlanVersionsResponseSchema>;
        },
        {
          params: t.Object({ id: t.String() }),
          response: {
            200: CellPlanVersionsResponseSchema,
            404: t.Object({ message: t.String() }),
          },
        }
      )
      .post(
        "/submit",
        async ({ params, body, set }) => {
          const { db } = await runServerEffect(DatabaseService);

          const [cell] = await db
            .select()
            .from(cells)
            .where(eq(cells.id, params.id));
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }
          if (cell.status === "archived") {
            set.status = HTTP_STATUS.BAD_REQUEST;
            return { message: "Cell is archived" };
          }

          const [{ value: latestVersion } = { value: null }] = await db
            .select({ value: max(cellPlans.version) })
            .from(cellPlans)
            .where(eq(cellPlans.cellId, params.id));

          const version = (latestVersion ?? 0) + 1;
          const id = `plan-${params.id}-${version}`;

          const now = new Date();
          await db.insert(cellPlans).values({
            id,
            cellId: params.id,
            version,
            content: body.content,
            feedback: null,
            createdAt: now,
          });

          await db
            .update(cells)
            .set({ phase: "plan_review" })
            .where(eq(cells.id, params.id));

          set.status = HTTP_STATUS.CREATED;
          return {
            plan: {
              id,
              cellId: params.id,
              version,
              content: body.content,
              createdAt: now.toISOString(),
              feedback: null,
            },
          } satisfies Static<typeof CellPlanResponseSchema>;
        },
        {
          params: t.Object({ id: t.String() }),
          body: SubmitCellPlanSchema,
          response: {
            201: CellPlanResponseSchema,
            400: t.Object({ message: t.String() }),
            404: t.Object({ message: t.String() }),
          },
        }
      )
      .post(
        "/request-revision",
        async ({ params, body, set }) => {
          const { db } = await runServerEffect(DatabaseService);

          const [cell] = await db
            .select()
            .from(cells)
            .where(eq(cells.id, params.id));
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }
          if (cell.status === "archived") {
            set.status = HTTP_STATUS.BAD_REQUEST;
            return { message: "Cell is archived" };
          }

          const [latest] = await db
            .select()
            .from(cellPlans)
            .where(eq(cellPlans.cellId, params.id))
            .orderBy(desc(cellPlans.version))
            .limit(1);

          if (!latest) {
            set.status = HTTP_STATUS.BAD_REQUEST;
            return { message: "No plan submitted" };
          }

          await db
            .update(cellPlans)
            .set({ feedback: body.feedback })
            .where(
              and(
                eq(cellPlans.cellId, params.id),
                eq(cellPlans.version, latest.version)
              )
            );

          await db
            .update(cells)
            .set({ phase: "planning" })
            .where(eq(cells.id, params.id));

          return {
            plan: toPlanResponse({ ...latest, feedback: body.feedback }),
          } satisfies Static<typeof CellPlanResponseSchema>;
        },
        {
          params: t.Object({ id: t.String() }),
          body: RequestPlanRevisionSchema,
          response: {
            200: CellPlanResponseSchema,
            400: t.Object({ message: t.String() }),
            404: t.Object({ message: t.String() }),
          },
        }
      )
      .post(
        "/approve",
        async ({ params, set }) => {
          const { db } = await runServerEffect(DatabaseService);
          const agentRuntime = await runServerEffect(AgentRuntimeServiceTag);

          const [cell] = await db
            .select()
            .from(cells)
            .where(eq(cells.id, params.id));
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }
          if (cell.status === "archived") {
            set.status = HTTP_STATUS.BAD_REQUEST;
            return { message: "Cell is archived" };
          }

          const [latest] = await db
            .select()
            .from(cellPlans)
            .where(eq(cellPlans.cellId, params.id))
            .orderBy(desc(cellPlans.version))
            .limit(1);

          if (!latest) {
            set.status = HTTP_STATUS.BAD_REQUEST;
            return { message: "No plan submitted" };
          }

          const [updatedCell] = await db
            .update(cells)
            .set({ phase: "implementation" })
            .where(eq(cells.id, params.id))
            .returning();

          const nextSessionId = updatedCell?.opencodeSessionId;
          if (nextSessionId) {
            await runServerEffect(
              agentRuntime.sendAgentMessage(
                nextSessionId,
                `Approved plan (v${latest.version}):\n\n${latest.content}`
              )
            );
          }

          set.status = HTTP_STATUS.OK;
          return { message: "ok" };
        },
        {
          params: t.Object({ id: t.String() }),
          response: {
            200: t.Object({ message: t.String() }),
            400: t.Object({ message: t.String() }),
            404: t.Object({ message: t.String() }),
          },
        }
      )
);
