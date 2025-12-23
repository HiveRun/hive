import type { Plugin, PluginInput } from "@opencode-ai/plugin";

const _HOOK_NAME = "todo-continuation-enforcer";

type Todo = {
  content: string;
  status: string;
  priority: string;
  id: string;
};

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`;

const detectInterrupt = (error: unknown): boolean => {
  if (!error) {
    return false;
  }
  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    const name = errObj.name as string | undefined;
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? "";
    if (name === "MessageAbortedError" || name === "AbortError") {
      return true;
    }
    if (name === "DOMException" && message.includes("abort")) {
      return true;
    }
    if (
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted")
    ) {
      return true;
    }
  }
  if (typeof error === "string") {
    const lower = error.toLowerCase();
    return (
      lower.includes("abort") ||
      lower.includes("cancel") ||
      lower.includes("interrupt")
    );
  }
  return false;
};

export type TodoContinuationEnforcer = {
  handler: (input: {
    event: { type: string; properties?: unknown };
  }) => Promise<void>;
};

export const createTodoContinuationEnforcer = (
  ctx: PluginInput
): TodoContinuationEnforcer => {
  const remindedSessions = new Set<string>();
  const interruptedSessions = new Set<string>();
  const errorSessions = new Set<string>();
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const CONTINUATION_CHECK_DELAY_MS = 200;

  const handleSessionError = (
    props: Record<string, unknown> | undefined
  ): void => {
    const sessionID = props?.sessionID as string | undefined;
    if (!sessionID) {
      return;
    }

    const isInterrupt = detectInterrupt(props?.error);
    errorSessions.add(sessionID);
    if (isInterrupt) {
      interruptedSessions.add(sessionID);
    }

    const timer = pendingTimers.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(sessionID);
    }
  };

  const shouldBypassInitialCheck = (sessionID: string): boolean => {
    const hasBypassFlag =
      interruptedSessions.has(sessionID) || errorSessions.has(sessionID);

    interruptedSessions.delete(sessionID);
    errorSessions.delete(sessionID);

    if (hasBypassFlag || remindedSessions.has(sessionID)) {
      return true;
    }

    return false;
  };

  const fetchIncompleteTodos = async (
    sessionID: string
  ): Promise<{ todos: Todo[]; incomplete: Todo[] } | null> => {
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID },
      });
      const todos = (response.data ?? response ?? []) as Todo[];

      if (!todos.length) {
        return null;
      }

      const incomplete = todos.filter(
        (todo) => todo.status !== "completed" && todo.status !== "cancelled"
      );

      if (!incomplete.length) {
        return null;
      }

      return { todos, incomplete };
    } catch {
      return null;
    }
  };

  const hasNewErrorOrInterrupt = (sessionID: string): boolean =>
    interruptedSessions.has(sessionID) || errorSessions.has(sessionID);

  const sendContinuationPrompt = async (
    sessionID: string,
    todos: Todo[],
    incomplete: Todo[]
  ): Promise<boolean> => {
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [
            {
              type: "text",
              text: `${CONTINUATION_PROMPT}\n\n[Status: ${
                todos.length - incomplete.length
              }/${todos.length} completed, ${incomplete.length} remaining]`,
            },
          ],
        },
        query: { directory: ctx.directory },
      });

      return true;
    } catch {
      return false;
    }
  };

  const runContinuationCheck = async (sessionID: string): Promise<void> => {
    if (shouldBypassInitialCheck(sessionID)) {
      return;
    }

    const result = await fetchIncompleteTodos(sessionID);
    if (!result) {
      return;
    }

    remindedSessions.add(sessionID);

    if (hasNewErrorOrInterrupt(sessionID)) {
      remindedSessions.delete(sessionID);
      return;
    }

    const { todos, incomplete } = result;

    const promptSucceeded = await sendContinuationPrompt(
      sessionID,
      todos,
      incomplete
    );

    if (!promptSucceeded) {
      remindedSessions.delete(sessionID);
    }
  };

  const handleSessionIdle = (
    props: Record<string, unknown> | undefined
  ): void => {
    const sessionID = props?.sessionID as string | undefined;
    if (!sessionID) {
      return;
    }

    const existingTimer = pendingTimers.get(sessionID);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      pendingTimers.delete(sessionID);
      await runContinuationCheck(sessionID);
    }, CONTINUATION_CHECK_DELAY_MS);

    pendingTimers.set(sessionID, timer);
  };

  const handleMessageUpdated = (
    props: Record<string, unknown> | undefined
  ): void => {
    const info = props?.info as Record<string, unknown> | undefined;
    const sessionID = info?.sessionID as string | undefined;
    const role = info?.role as string | undefined;

    if (!sessionID) {
      return;
    }

    if (role === "user") {
      const timer = pendingTimers.get(sessionID);
      if (timer) {
        clearTimeout(timer);
        pendingTimers.delete(sessionID);
      }
    }

    if (role === "assistant" && remindedSessions.has(sessionID)) {
      remindedSessions.delete(sessionID);
    }
  };

  const handleSessionDeleted = (
    props: Record<string, unknown> | undefined
  ): void => {
    const sessionInfo = props?.info as { id?: string } | undefined;
    const sessionID = sessionInfo?.id;
    if (!sessionID) {
      return;
    }

    remindedSessions.delete(sessionID);
    interruptedSessions.delete(sessionID);
    errorSessions.delete(sessionID);

    const timer = pendingTimers.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(sessionID);
    }
  };

  const handler = ({
    event,
  }: {
    event: { type: string; properties?: unknown };
  }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.error") {
      handleSessionError(props);
    } else if (event.type === "session.idle") {
      handleSessionIdle(props);
    } else if (event.type === "message.updated") {
      handleMessageUpdated(props);
    } else if (event.type === "session.deleted") {
      handleSessionDeleted(props);
    }

    return Promise.resolve();
  };

  return {
    handler,
  };
};

export const TodoContinuationEnforcerPlugin: Plugin = (ctx) => {
  const enforcer = createTodoContinuationEnforcer(ctx);
  return Promise.resolve({
    event: enforcer.handler,
  });
};
