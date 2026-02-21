import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const scriptsDir = import.meta.dirname;
const desktopRoot = join(scriptsDir, "..");
const rendererDistDir = join(scriptsDir, "..", "..", "web", "dist");
const desktopPublicDir = join(desktopRoot, "public");

const main = async () => {
  if (!existsSync(rendererDistDir)) {
    throw new Error(
      `Renderer build not found at ${rendererDistDir}. Run \`bun run build\` in apps/web first.`
    );
  }

  await rm(desktopPublicDir, { recursive: true, force: true });
  await cp(rendererDistDir, desktopPublicDir, { recursive: true });
};

await main();
