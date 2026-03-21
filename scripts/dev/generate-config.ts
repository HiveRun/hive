import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hiveConfigSchema } from "../../packages/config/src/hive-config-schema";
import { hiveConfigDefaults } from "./config.defaults";

const config = hiveConfigSchema.parse(hiveConfigDefaults);
const withSchema = { $schema: "./hive.config.schema.json", ...config };
const outputPath = resolve(process.cwd(), "hive.config.json");
const nextContent = `${JSON.stringify(withSchema, null, 2)}\n`;

const formatJson = (filePath: string) => {
  const result = Bun.spawnSync({
    cmd: ["bunx", "biome", "check", "--write", filePath],
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to format ${filePath} with Biome`);
  }
};

const prevContent = await readFile(outputPath, "utf8").catch(() => null);

if (prevContent !== nextContent) {
  await writeFile(outputPath, nextContent, "utf8");
  formatJson(outputPath);
  console.log(`Generated ${outputPath} from hiveConfigSchema`);
} else {
  console.log(`${outputPath} already up to date`);
}
