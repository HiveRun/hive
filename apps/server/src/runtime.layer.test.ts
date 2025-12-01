import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { AgentRuntimeServiceTag } from "./agents/service";
import { DatabaseService } from "./db";
import { LoggerService } from "./logger";
import { runServerEffect } from "./runtime";
import { WorktreeManagerServiceTag } from "./worktree/manager";

describe("serverLayer wiring", () => {
  test("provides core service tags", async () => {
    const resolved = await runServerEffect(
      Effect.gen(function* () {
        const worktree = yield* WorktreeManagerServiceTag;
        const agent = yield* AgentRuntimeServiceTag;
        const dbService = yield* DatabaseService;
        const logger = yield* LoggerService;
        return { worktree, agent, dbService, logger } as const;
      })
    );

    expect(typeof resolved.worktree.createManager).toBe("function");
    expect(typeof resolved.agent.ensureAgentSession).toBe("function");
    expect(resolved.dbService.db).toBeDefined();
    expect(typeof resolved.logger.info).toBe("function");
  });
});
