import { Elysia, t } from "elysia";
import {
  completeConstruct,
  type DbInstance,
  deleteConstruct,
  getConstruct,
  listConstructs,
  updateConstruct,
} from "../db";
import type { SyntheticConfig } from "../lib/schema";
import {
  provisionConstruct,
  startConstructAgent,
} from "../services/provisioner";

export const constructsRoute = (
  db: DbInstance,
  config: SyntheticConfig,
  workspacePath: string
) =>
  new Elysia({ prefix: "/api/constructs" })
    .get("/", async () => {
      const constructs = await listConstructs(db);
      return constructs;
    })

    .get("/:id", async ({ params, set }) => {
      const construct = await getConstruct(db, params.id);
      if (!construct) {
        set.status = 404;
        return { error: "Construct not found" };
      }
      return construct;
    })

    .post(
      "/",
      async ({ body, set }) => {
        try {
          const provisioned = await provisionConstruct(db, config, {
            name: body.name,
            description: body.description,
            templateId: body.templateId,
            workspacePath,
          });

          return provisioned;
        } catch (err) {
          set.status = 400;
          return {
            error:
              err instanceof Error
                ? err.message
                : "Failed to provision construct",
          };
        }
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          templateId: t.String(),
        }),
      }
    )

    .patch(
      "/:id",
      async ({ params, body, set }) => {
        try {
          const updated = await updateConstruct(db, params.id, body);
          if (!updated) {
            set.status = 404;
            return { error: "Construct not found" };
          }
          return updated;
        } catch (err) {
          set.status = 400;
          return {
            error:
              err instanceof Error ? err.message : "Failed to update construct",
          };
        }
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          description: t.Optional(t.String()),
          status: t.Optional(
            t.Union([
              t.Literal("draft"),
              t.Literal("provisioning"),
              t.Literal("active"),
              t.Literal("awaiting_input"),
              t.Literal("reviewing"),
              t.Literal("completed"),
              t.Literal("parked"),
              t.Literal("archived"),
              t.Literal("error"),
            ])
          ),
        }),
      }
    )

    .post("/:id/complete", async ({ params, set }) => {
      try {
        const completed = await completeConstruct(db, params.id);
        if (!completed) {
          set.status = 404;
          return { error: "Construct not found" };
        }
        return completed;
      } catch (err) {
        set.status = 400;
        return {
          error:
            err instanceof Error ? err.message : "Failed to complete construct",
        };
      }
    })

    .delete("/:id", async ({ params }) => {
      await deleteConstruct(db, params.id);
      return { success: true };
    })

    .post(
      "/:id/agent/start",
      async ({ params, body, set }) => {
        try {
          const session = await startConstructAgent(
            db,
            params.id,
            body.provider || "anthropic"
          );
          return {
            sessionId: session.id,
            status: session.status,
          };
        } catch (err) {
          set.status = 400;
          return {
            error: err instanceof Error ? err.message : "Failed to start agent",
          };
        }
      },
      {
        body: t.Object({
          provider: t.Optional(
            t.Union([t.Literal("anthropic"), t.Literal("openai")])
          ),
        }),
      }
    );
