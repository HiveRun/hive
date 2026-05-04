import { join } from "node:path";

import { runPatternCheck, scriptLikeExtensions } from "./scan-files";

const rootDir = process.cwd();
const testFilePattern = /(?:\.test|\.spec|\.e2e)\.[^.]+$/;
const blockedPattern =
  /\b(?:test|it|describe)\.(?:fixme|skip)\s*\(|\.(?:fixme|skip)\s*\(/g;

runPatternCheck({
  scanRoots: [join(rootDir, "apps"), join(rootDir, "packages")],
  allowedExtensions: scriptLikeExtensions,
  ignoredDirectories: new Set(["node_modules", "dist", "build"]),
  blockedPattern,
  shouldInspectFile: (fileName) => testFilePattern.test(fileName),
  rootDir,
  failureMessage:
    "Disabled tests are not allowed. Remove fixme/skip annotations:",
  emptyMessage: "No disabled tests found.",
});
