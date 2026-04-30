import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type MigrationJournalFinding = {
  message: string;
};

type MigrationJournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

type MigrationJournal = {
  entries?: unknown;
};

type JournalScanState = {
  journalTags: Set<string>;
  latestRequiredTimestamp: number | null;
  previousTag: string | null;
};

const defaultMigrationsDir = join(
  process.cwd(),
  "apps",
  "server",
  "src",
  "migrations"
);
const initialPromptImagesMigrationTimestamp = 1_776_611_005_583;
const legacyTimestampExceptionTimestamps = new Map([
  ["0013_gigantic_blonde_phantom", initialPromptImagesMigrationTimestamp],
]);
const migrationIndexWidth = 4;
const sqlExtension = ".sql";

export const checkMigrationJournal = (
  migrationsDir = defaultMigrationsDir
): MigrationJournalFinding[] => {
  const findings: MigrationJournalFinding[] = [];
  const entries = readJournalEntries(migrationsDir, findings);
  if (!entries) {
    return findings;
  }

  const state: JournalScanState = {
    journalTags: new Set<string>(),
    latestRequiredTimestamp: null,
    previousTag: null,
  };

  for (const [index, entry] of entries.entries()) {
    inspectJournalEntry({ entry, findings, index, migrationsDir, state });
  }

  inspectSqlMigrationFiles(migrationsDir, state.journalTags, findings);

  return findings;
};

const readJournalEntries = (
  migrationsDir: string,
  findings: MigrationJournalFinding[]
) => {
  const journalPath = join(migrationsDir, "meta", "_journal.json");

  if (!existsSync(journalPath)) {
    findings.push({ message: `Missing migration journal at ${journalPath}` });
    return null;
  }

  const journal = readJournal(journalPath, findings);
  if (!journal) {
    return null;
  }

  if (!Array.isArray(journal.entries)) {
    findings.push({ message: "Migration journal entries must be an array" });
    return null;
  }

  return journal.entries;
};

const inspectJournalEntry = (input: {
  entry: unknown;
  findings: MigrationJournalFinding[];
  index: number;
  migrationsDir: string;
  state: JournalScanState;
}) => {
  const { entry, findings, index, migrationsDir, state } = input;
  if (!isMigrationJournalEntry(entry)) {
    findings.push({
      message: `Journal entry at index ${index} must include numeric idx/when and string tag`,
    });
    return;
  }

  inspectEntryIndex(entry, index, findings);
  inspectEntryTagOrder(entry, state, findings);
  inspectEntrySqlFile(entry, migrationsDir, findings);
  inspectEntryTimestamp(entry, state, findings);
};

const inspectEntryIndex = (
  entry: MigrationJournalEntry,
  index: number,
  findings: MigrationJournalFinding[]
) => {
  if (entry.idx !== index) {
    findings.push({
      message: `${entry.tag} has idx ${entry.idx}, expected ${index}`,
    });
  }

  const expectedPrefix = String(index).padStart(migrationIndexWidth, "0");
  if (!entry.tag.startsWith(`${expectedPrefix}_`)) {
    findings.push({
      message: `${entry.tag} should start with ${expectedPrefix}_ to match its journal index`,
    });
  }
};

const inspectEntryTagOrder = (
  entry: MigrationJournalEntry,
  state: JournalScanState,
  findings: MigrationJournalFinding[]
) => {
  if (entry.tag <= (state.previousTag ?? "")) {
    findings.push({
      message: `${entry.tag} is not ordered after ${state.previousTag}`,
    });
  }
  state.previousTag = entry.tag;

  if (state.journalTags.has(entry.tag)) {
    findings.push({ message: `${entry.tag} appears more than once` });
  }
  state.journalTags.add(entry.tag);
};

const inspectEntrySqlFile = (
  entry: MigrationJournalEntry,
  migrationsDir: string,
  findings: MigrationJournalFinding[]
) => {
  if (!existsSync(join(migrationsDir, `${entry.tag}${sqlExtension}`))) {
    findings.push({ message: `${entry.tag}${sqlExtension} is missing` });
  }
};

const inspectEntryTimestamp = (
  entry: MigrationJournalEntry,
  state: JournalScanState,
  findings: MigrationJournalFinding[]
) => {
  if (
    state.latestRequiredTimestamp !== null &&
    entry.when <= state.latestRequiredTimestamp
  ) {
    if (!isLegacyTimestampException(entry)) {
      findings.push({
        message: `${entry.tag} has timestamp ${entry.when}, which must be greater than ${state.latestRequiredTimestamp}. Drizzle skips migrations whose timestamp is not newer than the latest applied row.`,
      });
    }
    return;
  }

  state.latestRequiredTimestamp = entry.when;
};

const isLegacyTimestampException = (entry: MigrationJournalEntry) =>
  legacyTimestampExceptionTimestamps.get(entry.tag) === entry.when;

const inspectSqlMigrationFiles = (
  migrationsDir: string,
  journalTags: Set<string>,
  findings: MigrationJournalFinding[]
) => {
  for (const sqlFile of readSqlMigrationFiles(migrationsDir)) {
    const tag = sqlFile.slice(0, -sqlExtension.length);
    if (!journalTags.has(tag)) {
      findings.push({ message: `${sqlFile} is not listed in _journal.json` });
    }
  }
};

const readJournal = (
  journalPath: string,
  findings: MigrationJournalFinding[]
) => {
  try {
    return JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  } catch (error) {
    findings.push({
      message: `Failed to parse ${journalPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return null;
  }
};

const isMigrationJournalEntry = (
  entry: unknown
): entry is MigrationJournalEntry => {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Partial<MigrationJournalEntry>;
  return (
    typeof candidate.idx === "number" &&
    typeof candidate.tag === "string" &&
    typeof candidate.when === "number"
  );
};

const readSqlMigrationFiles = (migrationsDir: string) =>
  readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(sqlExtension))
    .sort();

if (import.meta.main) {
  const findings = checkMigrationJournal();

  if (findings.length > 0) {
    process.stderr.write("Migration journal integrity check failed:\n");
    for (const finding of findings) {
      process.stderr.write(`- ${finding.message}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `Migration journal integrity check passed for ${relative(
      process.cwd(),
      defaultMigrationsDir
    )}.\n`
  );
}
