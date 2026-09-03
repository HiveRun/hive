import { resolve } from "node:path";
import { Plugin } from "@opencode-ai/plugin";
import { createAstGrepTools } from "./tools";

export const AST_GREP_PLUGIN_ID = "hive.ast-grep.v2.r1.search-replace";

export default Plugin.define({
  id: AST_GREP_PLUGIN_ID,
  async setup(context) {
    const references = await context.reference
      .list()
      .then((response) =>
        response.data.map((reference) => resolve(reference.path))
      )
      .catch(() => []);
    const tools = createAstGrepTools(
      resolve(context.location.directory),
      references,
      resolve(context.location.project.directory)
    );
    await context.tool.transform((draft) => {
      for (const definition of tools) {
        draft.add(definition);
      }
    });
  },
});
