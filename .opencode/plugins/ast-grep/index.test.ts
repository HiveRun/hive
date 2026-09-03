import { describe, expect, it } from "bun:test";
import astGrepPlugin, { AST_GREP_PLUGIN_ID } from "./index";
import type { AstGrepV2Tool } from "./tools";

describe("ast-grep v2 plugin", () => {
  it("registers the existing search and replace tools", async () => {
    const tools = await registerTools("/workspace");

    expect(astGrepPlugin.id).toBe(AST_GREP_PLUGIN_ID);
    expect([...tools.keys()]).toEqual(["ast_grep_search", "ast_grep_replace"]);
    expect(tools.get("ast_grep_search")?.input).toMatchObject({
      required: ["pattern", "lang"],
    });
    expect(tools.get("ast_grep_replace")?.input).toMatchObject({
      required: ["pattern", "rewrite", "lang"],
    });
  });

  it("rejects replacements outside the active worktree", async () => {
    const tools = await registerTools("/workspace");
    const replace = tools.get("ast_grep_replace");
    if (!replace) {
      throw new Error("ast_grep_replace was not registered");
    }

    const result = await replace.execute(
      {
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        lang: "typescript",
        paths: ["/other-worktree"],
        dryRun: false,
      },
      {}
    );

    expect(result.content).toContain(
      "Error: Path is outside the allowed workspace boundary"
    );
  });
});

async function registerTools(cwd: string) {
  const tools = new Map<string, AstGrepV2Tool>();
  await astGrepPlugin.setup({
    location: {
      directory: cwd,
      project: { directory: cwd },
    },
    reference: {
      list: () => Promise.resolve({ data: [] }),
    },
    tool: {
      transform: (
        callback: (draft: { add: (tool: AstGrepV2Tool) => void }) => void
      ) => {
        callback({ add: (tool) => tools.set(tool.name, tool) });
        return Promise.resolve({ dispose: () => Promise.resolve() });
      },
    },
  } as never);
  return tools;
}
