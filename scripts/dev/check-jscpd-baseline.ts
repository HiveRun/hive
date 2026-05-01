import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JscpdFileLocation = {
  name: string;
  start: number;
  end: number;
};

type JscpdDuplicate = {
  format: string;
  lines: number;
  fragment: string;
  firstFile: JscpdFileLocation;
  secondFile: JscpdFileLocation;
};

type JscpdReport = {
  duplicates?: JscpdDuplicate[];
};

type BaselineEntry = {
  signature: string;
  format: string;
  files: [string, string];
  fragmentHash: string;
  count: number;
  examples: {
    firstStart: number;
    secondStart: number;
    lines: number;
  }[];
};

type Baseline = {
  version: 1;
  generatedAt: string;
  config: {
    mode: "strict";
    minLines: "jscpd default";
    minTokens: "jscpd default";
  };
  duplicateCount: number;
  entries: BaselineEntry[];
};

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const baselinePath = join(rootDirectory, "jscpd-baseline.json");
const configPath = join(rootDirectory, "jscpd.config.json");
const reportDirectory = join(rootDirectory, "tmp", "jscpd");
const reportPath = join(reportDirectory, "jscpd-report.json");
const jscpdBinary = join(
  rootDirectory,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "jscpd.cmd" : "jscpd"
);
const fragmentHashLength = 16;
const maxStoredExamples = 3;
const maxPrintedFailures = 20;

const normalizeFileName = (name: string) => name.replaceAll("\\", "/");

const hashFragment = (fragment: string) =>
  createHash("sha256")
    .update(fragment.replaceAll("\r\n", "\n").trim())
    .digest("hex")
    .slice(0, fragmentHashLength);

const getDuplicateSignatureParts = (duplicate: JscpdDuplicate) => {
  const files = [
    normalizeFileName(duplicate.firstFile.name),
    normalizeFileName(duplicate.secondFile.name),
  ].sort() as [string, string];
  const fragmentHash = hashFragment(duplicate.fragment);

  return {
    files,
    fragmentHash,
    signature: [duplicate.format, files[0], files[1], fragmentHash].join("|"),
  };
};

const createBaselineEntries = (duplicates: JscpdDuplicate[]) => {
  const entries = new Map<string, BaselineEntry>();

  for (const duplicate of duplicates) {
    const { files, fragmentHash, signature } =
      getDuplicateSignatureParts(duplicate);
    const existing = entries.get(signature);

    if (existing) {
      existing.count += 1;
      if (existing.examples.length < maxStoredExamples) {
        existing.examples.push({
          firstStart: duplicate.firstFile.start,
          secondStart: duplicate.secondFile.start,
          lines: duplicate.lines,
        });
      }
      continue;
    }

    entries.set(signature, {
      signature,
      format: duplicate.format,
      files,
      fragmentHash,
      count: 1,
      examples: [
        {
          firstStart: duplicate.firstFile.start,
          secondStart: duplicate.secondFile.start,
          lines: duplicate.lines,
        },
      ],
    });
  }

  return [...entries.values()].sort((left, right) =>
    left.signature.localeCompare(right.signature)
  );
};

const createBaseline = (entries: BaselineEntry[]): Baseline => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  config: {
    mode: "strict",
    minLines: "jscpd default",
    minTokens: "jscpd default",
  },
  duplicateCount: entries.reduce((total, entry) => total + entry.count, 0),
  entries,
});

const runJscpd = async () => {
  await rm(reportDirectory, { recursive: true, force: true });
  await mkdir(reportDirectory, { recursive: true });

  const process = Bun.spawn(
    [
      jscpdBinary,
      "--config",
      configPath,
      "--reporters",
      "json",
      "--silent",
      "--output",
      reportDirectory,
      ".",
    ],
    {
      cwd: rootDirectory,
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`jscpd failed with exit code ${exitCode}`);
  }
};

const readCurrentEntries = async () => {
  await runJscpd();
  const report = JSON.parse(await readFile(reportPath, "utf8")) as JscpdReport;
  return createBaselineEntries(report.duplicates ?? []);
};

const loadBaseline = async () => {
  if (!existsSync(baselinePath)) {
    throw new Error(
      "Missing jscpd-baseline.json. Run `bun run jscpd:update-baseline` to create it."
    );
  }

  return JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
};

const findNewEntries = (
  currentEntries: BaselineEntry[],
  baselineEntries: BaselineEntry[]
) => {
  const baselineCounts = new Map(
    baselineEntries.map((entry) => [entry.signature, entry.count])
  );

  return currentEntries.filter(
    (entry) => entry.count > (baselineCounts.get(entry.signature) ?? 0)
  );
};

const countEntries = (entries: BaselineEntry[]) =>
  entries.reduce((total, entry) => total + entry.count, 0);

const formatEntry = (entry: BaselineEntry) =>
  `${entry.format}: ${entry.files.join(" <-> ")} (${entry.count} clone${entry.count === 1 ? "" : "s"})`;

const main = async () => {
  const updateBaseline = process.argv.includes("--update");
  const currentEntries = await readCurrentEntries();

  if (updateBaseline) {
    const baseline = createBaseline(currentEntries);
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Updated jscpd-baseline.json with ${baseline.duplicateCount} existing duplicate clone${baseline.duplicateCount === 1 ? "" : "s"}.`
    );
    return;
  }

  const baseline = await loadBaseline();
  const newEntries = findNewEntries(currentEntries, baseline.entries);

  if (newEntries.length > 0) {
    console.error(
      `jscpd found ${countEntries(newEntries)} unbaselined duplicate clone${countEntries(newEntries) === 1 ? "" : "s"}.`
    );
    console.error(
      "Run `bun run jscpd:update-baseline` only after reviewing the duplicates."
    );
    for (const entry of newEntries.slice(0, maxPrintedFailures)) {
      console.error(`- ${formatEntry(entry)}`);
    }
    if (newEntries.length > maxPrintedFailures) {
      console.error(
        `- ...and ${newEntries.length - maxPrintedFailures} more duplicate signatures.`
      );
    }
    process.exitCode = 1;
    return;
  }

  const duplicateCount = countEntries(currentEntries);
  console.log(
    `jscpd baseline check passed: ${duplicateCount} duplicate clone${duplicateCount === 1 ? "" : "s"} match the strict baseline.`
  );
};

await main();
