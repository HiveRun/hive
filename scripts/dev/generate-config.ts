import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hiveConfigSchema } from "../../apps/server/src/config/schema";
import { hiveConfigDefaults } from "./config.defaults";

const config = hiveConfigSchema.parse(hiveConfigDefaults);
const outputPath = resolve(process.cwd(), "hive.config.jsonc");

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(`Generated ${outputPath} from hiveConfigSchema`);
