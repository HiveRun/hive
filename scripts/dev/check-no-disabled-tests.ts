import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const rootDir = process.cwd();
const scanRoots = [join(rootDir, "apps"), join(rootDir, "packages")];
const allowedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const testFilePattern = /(?:\.test|\.spec|\.e2e)\.[^.]+$/;
const blockedPattern =
  /\b(?:test|it|describe)\.(?:fixme|skip)\s*\(|\.(?:fixme|skip)\s*\(/g;

type Finding = {
  filePath: string;
  line: number;
  match: string;
};

const findings: Finding[] = [];

for (const scanRoot of scanRoots) {
  visit(scanRoot);
}

if (findings.length > 0) {
  process.stderr.write(
    "Disabled tests are not allowed. Remove fixme/skip annotations:\n"
  );

  for (const finding of findings) {
    process.stderr.write(
      `- ${relative(rootDir, finding.filePath)}:${finding.line} (${finding.match.trim()})\n`
    );
  }

  process.exit(1);
}

process.stdout.write("No disabled tests found.\n");

function visit(directoryPath: string) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (isIgnoredDirectory(entry.name)) {
      continue;
    }

    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      visit(entryPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!hasAllowedExtension(entry.name)) {
      continue;
    }

    if (!testFilePattern.test(entry.name)) {
      continue;
    }

    inspectFile(entryPath);
  }
}

function isIgnoredDirectory(name: string) {
  return ["node_modules", "dist", "build"].includes(name);
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

function getLineNumber(source: string, index: number) {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
    }
  }

  return line;
}
