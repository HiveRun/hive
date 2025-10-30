import { basename } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

export const IdleNotify: Plugin = ({ $, directory }) => {
  const sessionName = basename(directory).trim();

  return Promise.resolve({
    event: async ({ event }) => {
      if (event.type !== "session.idle") {
        return;
      }

      const title = `${sessionName} - Awaiting Input`;
      const summary = `Session ${sessionName} is idle.`;

      try {
        await $`notify-send -u normal -t 0 ${title} ${summary}`;
      } catch {
        // ignore notification failures
      }
    },
  });
};
