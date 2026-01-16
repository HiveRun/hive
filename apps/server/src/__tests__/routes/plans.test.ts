import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeServiceTag } from "../../agents/service";
import { DatabaseService } from "../../db";
import { cellPlansRoutes } from "../../routes/plans";

const Runtime = await import("../../runtime");

import { cellPlans } from "../../schema/cell-plans";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const cellId = "cell-plan-test";

const createApp = () => new Elysia().use(cellPlansRoutes);

describe("cellPlansRoutes", () => {
  let runServerEffectSpy: any;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await setupTestDb();

    vi.restoreAllMocks();
    runServerEffectSpy = vi.spyOn(Runtime, "runServerEffect");
    runServerEffectSpy.mockImplementation((effect: any) =>
      Effect.runPromise(
        (effect as any).pipe(
          Effect.provideService(DatabaseService, { db: testDb }),
          Effect.provideService(AgentRuntimeServiceTag, {
            sendAgentMessage: () => Effect.void,
          } as any)
        )
      )
    );

    await testDb.delete(cellPlans);
    await testDb.delete(cells);

    await testDb.insert(cells).values({
      id: cellId,
      name: "Plan Cell",
      description: "",
      templateId: "template-basic",
      workspacePath: "/tmp/cell-plan",
      workspaceId: "workspace-1",
      workspaceRootPath: "/tmp/cell-plan",
      createdAt: new Date(),
      status: "ready",
      phase: "planning",
      opencodeSessionId: null,
    });
  });

  it("returns null when no plan exists", async () => {
    const app = createApp();

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/plan`)
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as { plan: unknown | null };
    expect(payload.plan).toBeNull();
  });

  it("submits a plan and transitions to plan_review", async () => {
    const app = createApp();

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/plan/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Do the thing" }),
      })
    );

    expect(response.status).toBe(HTTP_CREATED);
    const payload = (await response.json()) as {
      plan: { id: string; cellId: string; version: number; content: string };
    };

    expect(payload.plan.cellId).toBe(cellId);
    expect(payload.plan.version).toBe(1);
    expect(payload.plan.content).toBe("Do the thing");

    const [updatedCell] = await testDb
      .select()
      .from(cells)
      .where(eq(cells.id, cellId));
    expect(updatedCell?.phase).toBe("plan_review");

    const plans = await testDb
      .select()
      .from(cellPlans)
      .where(eq(cellPlans.cellId, cellId));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.version).toBe(1);
  });

  it("stores feedback and transitions back to planning", async () => {
    await testDb.insert(cellPlans).values({
      id: `plan-${cellId}-1`,
      cellId,
      version: 1,
      content: "Initial plan",
      feedback: null,
      createdAt: new Date(),
    });

    await testDb
      .update(cells)
      .set({ phase: "plan_review" })
      .where(eq(cells.id, cellId));

    const app = createApp();

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${cellId}/plan/request-revision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: "Needs more detail" }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);

    const [updatedCell] = await testDb
      .select()
      .from(cells)
      .where(eq(cells.id, cellId));
    expect(updatedCell?.phase).toBe("planning");

    const [updatedPlan] = await testDb
      .select()
      .from(cellPlans)
      .where(eq(cellPlans.id, `plan-${cellId}-1`));
    expect(updatedPlan?.feedback).toBe("Needs more detail");
  });

  it("returns 400 when requesting revision without a plan", async () => {
    const app = createApp();

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${cellId}/plan/request-revision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: "No plan" }),
        }
      )
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("No plan submitted");
  });

  it("approves the plan and transitions to implementation", async () => {
    await testDb.insert(cellPlans).values({
      id: `plan-${cellId}-1`,
      cellId,
      version: 1,
      content: "Initial plan",
      feedback: null,
      createdAt: new Date(),
    });

    const app = createApp();

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/plan/approve`, {
        method: "POST",
      })
    );

    expect(response.status).toBe(HTTP_OK);

    const [updatedCell] = await testDb
      .select()
      .from(cells)
      .where(eq(cells.id, cellId));
    expect(updatedCell?.phase).toBe("implementation");
  });

  it("returns 404 when cell is missing", async () => {
    await testDb.delete(cellPlans);
    await testDb.delete(cells);

    const app = createApp();

    const response = await app.handle(
      new Request("http://localhost/api/cells/missing/plan")
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });
});
