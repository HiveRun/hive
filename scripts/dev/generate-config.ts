import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hiveConfigSchema } from "../../apps/server/src/config/schema";
import { hiveConfigDefaults } from "./config.defaults";

const config = hiveConfigSchema.parse(hiveConfigDefaults);
const withSchema = { $schema: "./hive.config.schema.json", ...config };
const outputPath = resolve(process.cwd(), "hive.config.json");
const nextContent = `${JSON.stringify(withSchema, null, 2)}\n`;

const prevContent = await readFile(outputPath, "utf8").catch(() => null);

if (prevContent !== nextContent) {
  await writeFile(outputPath, nextContent, "utf8");
  console.log(`Generated ${outputPath} from hiveConfigSchema`);
} else {
  console.log(`${outputPath} already up to date`);
}
