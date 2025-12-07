import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { zodToJsonSchema } from "zod-to-json-schema";

import { hiveConfigSchema } from "../../apps/server/src/config/schema";

const schema = zodToJsonSchema(hiveConfigSchema, {
  name: "HiveConfig",
  $refStrategy: "none",
});

const outputPath = resolve(process.cwd(), "hive.config.schema.json");
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Generated ${outputPath} from hiveConfigSchema`);
