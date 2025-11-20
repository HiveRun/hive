import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const binaryDirectory = dirname(process.execPath);

const normalize = (value: string | undefined) =>
  value ? resolve(value) : undefined;

const unique = <T>(values: (T | undefined)[]) => {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

const ensureDirectory = (dir: string) => {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export const resolveStaticAssetsDirectory = (): string => {
  const candidateDirectories = unique(
    [
      normalize(process.env.SYNTHETIC_WEB_DIST),
      normalize(join(binaryDirectory, "public")),
      normalize(join(moduleDir, "../../public")),
      normalize(fileURLToPath(new URL("../../../web/dist", import.meta.url))),
    ].filter((dir): dir is string => Boolean(dir))
  );

  for (const directory of candidateDirectories) {
    if (ensureDirectory(directory)) {
      return directory;
    }
  }

  return "";
};
