import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Finding = {
  filePath: string;
  line: number;
  match: string;
};

export const scriptLikeExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

type CollectPatternFindingsOptions = {
  scanRoots: string[];
  allowedExtensions: Set<string>;
  ignoredDirectories: Set<string>;
  blockedPattern: RegExp;
  shouldInspectFile?: (fileName: string) => boolean;
};

type RunPatternCheckOptions = CollectPatternFindingsOptions & {
  emptyMessage: string;
  failureMessage: string;
  rootDir: string;
};

export function runPatternCheck({
  emptyMessage,
  failureMessage,
  rootDir,
  ...collectOptions
}: RunPatternCheckOptions) {
  const findings = collectPatternFindings(collectOptions);
  if (findings.length === 0) {
    process.stdout.write(`${emptyMessage}\n`);
    return;
  }

  process.stderr.write(`${failureMessage}\n`);
  for (const finding of findings) {
    const path = relative(rootDir, finding.filePath);
    process.stderr.write(
      `- ${path}:${finding.line} (${finding.match.trim()})\n`
    );
  }
  process.exit(1);
}

export function collectPatternFindings({
  scanRoots,
  allowedExtensions,
  ignoredDirectories,
  blockedPattern,
  shouldInspectFile = () => true,
}: CollectPatternFindingsOptions) {
  const findings: Finding[] = [];

  for (const scanRoot of scanRoots) {
    visit(scanRoot);
  }

  return findings;

  function visit(directoryPath: string) {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(entryPath);
        }
        continue;
      }

      if (shouldVisitFile(entry.name, entry.isFile())) {
        inspectFile(entryPath);
      }
    }
  }

  function shouldVisitFile(fileName: string, isFile: boolean) {
    return (
      isFile && hasAllowedExtension(fileName) && shouldInspectFile(fileName)
    );
  }

  function hasAllowedExtension(fileName: string) {
    const extension = fileName.slice(fileName.lastIndexOf("."));
    return allowedExtensions.has(extension);
  }

  function inspectFile(filePath: string) {
    if (!statSync(filePath).isFile()) {
      return;
    }

    const source = readFileSync(filePath, "utf8");
    blockedPattern.lastIndex = 0;

    for (const match of source.matchAll(blockedPattern)) {
      findings.push({
        filePath,
        line: getLineNumber(source, match.index ?? 0),
        match: match[0],
      });
    }
  }
}

function getLineNumber(source: string, index: number) {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
    }
  }

  return line;
}
