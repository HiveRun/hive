import { runPatternCheck, scriptLikeExtensions } from "./scan-files";

const rootDir = process.cwd();
const sourceExtensions = new Set([...scriptLikeExtensions, ".json"]);
const duplicateTool = "jscpd";
const blockedPattern = new RegExp(
  `${duplicateTool}\\s*:\\s*ignore|${duplicateTool}-ignore\\b|c` +
    "pd-ignore\\b",
  "gi"
);

runPatternCheck({
  scanRoots: [rootDir],
  allowedExtensions: sourceExtensions,
  ignoredDirectories: new Set([
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".cache",
    "reports",
    "test-results",
    "tmp",
    "temp",
    ".hive",
    ".opencode",
  ]),
  blockedPattern,
  rootDir,
  failureMessage:
    "Duplicate-code ignore comments are not allowed. Remove these suppressions:",
  emptyMessage: "No duplicate-code ignore comments found.",
});
