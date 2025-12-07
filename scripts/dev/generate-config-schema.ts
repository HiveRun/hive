import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { hiveConfigSchema } from "../../apps/server/src/config/schema";

const schema = z.toJSONSchema(hiveConfigSchema);
const hydratedSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "hive.config.schema.json",
  title: "HiveConfig",
  ...schema,
  properties: {
    $schema: { type: "string" },
    ...(schema as { properties?: Record<string, unknown> }).properties,
  },
};

const outputPath = resolve(process.cwd(), "hive.config.schema.json");
await writeFile(
  outputPath,
  `${JSON.stringify(hydratedSchema, null, 2)}\n`,
  "utf8"
);

console.log(`Generated ${outputPath}`);
