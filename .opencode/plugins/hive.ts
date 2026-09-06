import { existsSync } from "node:fs";
import { join } from "node:path";
import { Plugin } from "@opencode-ai/plugin";
import {
  HIVE_PLUGIN_ID,
  setupHivePlugin,
} from "../../apps/server/src/agents/tools/hive";

const HIVE_SOURCE_PLUGIN_ID = `${HIVE_PLUGIN_ID}.source`;

export default Plugin.define({
  id: HIVE_SOURCE_PLUGIN_ID,
  async setup(context) {
    const generatedPluginPath = join(
      context.location.project.directory,
      ".opencode",
      "plugins",
      "hive",
      "index.js"
    );
    if (existsSync(generatedPluginPath)) {
      return;
    }

    await setupHivePlugin(context);
  },
});
