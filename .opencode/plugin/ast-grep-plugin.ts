import type { Plugin } from "@opencode-ai/plugin";
import { ast_grep_replace, ast_grep_search } from "./ast-grep/tools";

export const AstGrepPlugin: Plugin = async () => ({
  tool: {
    ast_grep_search,
    ast_grep_replace,
  },
});
