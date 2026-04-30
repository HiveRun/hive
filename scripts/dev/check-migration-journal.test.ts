import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMigrationJournal } from "./check-migration-journal";

const tempDirectories: string[] = [];
const firstMigrationTimestamp = 1000;
const secondMigrationTimestamp = 2000;
const regressedMigrationTimestamp = 900;
const knownExceptionIndex = 13;
const knownExceptionEntryCount = knownExceptionIndex + 1;
const futureMigrationIndex = knownExceptionIndex + 1;
const futureEntryCount = futureMigrationIndex + 1;
const knownExceptionTimestamp = 1_776_611_005_583;
const changedKnownExceptionTimestamp = 1500;
const generatedTimestampStep = 100;
const latestTimestampBeforeKnownException = 1_786_000_000_000;
const generatedTimestampBase =
  latestTimestampBeforeKnownException -
  (knownExceptionIndex - 1) * generatedTimestampStep;
const migrationIndexWidth = 4;
const futureRegressedTimestamp = latestTimestampBeforeKnownException - 1;
const journalJsonIndent = 2;

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("checkMigrationJournal", () => {
  test("accepts ordered migration metadata", () => {
    const migrationsDir = createMigrationsDir([
      journalEntry(0, "0000_initial", firstMigrationTimestamp),
      journalEntry(1, "0001_next", secondMigrationTimestamp),
    ]);

    expect(checkMigrationJournal(migrationsDir)).toEqual([]);
  });

  test("rejects new timestamp regressions", () => {
    const migrationsDir = createMigrationsDir([
      journalEntry(0, "0000_initial", firstMigrationTimestamp),
      journalEntry(1, "0001_next", regressedMigrationTimestamp),
    ]);

    expect(checkMigrationJournal(migrationsDir)).toContainEqual({
      message: `0001_next has timestamp ${regressedMigrationTimestamp}, which must be greater than ${firstMigrationTimestamp}. Drizzle skips migrations whose timestamp is not newer than the latest applied row.`,
    });
  });

  test("allows the known shipped 0013 timestamp regression", () => {
    const entries = Array.from(
      { length: knownExceptionEntryCount },
      (_, index) => generatedJournalEntry(index)
    );

    const migrationsDir = createMigrationsDir(entries);

    expect(checkMigrationJournal(migrationsDir)).toEqual([]);
  });

  test("rejects future migrations below the latest non-exception timestamp", () => {
    const entries = Array.from({ length: futureEntryCount }, (_, index) =>
      generatedJournalEntry(index)
    );
    entries[futureMigrationIndex] = journalEntry(
      futureMigrationIndex,
      "0014_future",
      futureRegressedTimestamp
    );

    const migrationsDir = createMigrationsDir(entries);

    expect(checkMigrationJournal(migrationsDir)).toContainEqual({
      message: `0014_future has timestamp ${futureRegressedTimestamp}, which must be greater than ${latestTimestampBeforeKnownException}. Drizzle skips migrations whose timestamp is not newer than the latest applied row.`,
    });
  });

  test("rejects changes to the known shipped timestamp exception", () => {
    const entries = Array.from(
      { length: knownExceptionEntryCount },
      (_, index) => generatedJournalEntry(index)
    );
    entries[knownExceptionIndex] = journalEntry(
      knownExceptionIndex,
      "0013_gigantic_blonde_phantom",
      changedKnownExceptionTimestamp
    );

    const migrationsDir = createMigrationsDir(entries);

    expect(checkMigrationJournal(migrationsDir)).toContainEqual({
      message: `0013_gigantic_blonde_phantom has timestamp ${changedKnownExceptionTimestamp}, which must be greater than ${latestTimestampBeforeKnownException}. Drizzle skips migrations whose timestamp is not newer than the latest applied row.`,
    });
  });

  test("reports missing and untracked migration files", () => {
    const migrationsDir = createMigrationsDir([
      journalEntry(0, "0000_initial", firstMigrationTimestamp),
      journalEntry(1, "0001_missing", secondMigrationTimestamp),
    ]);
    writeFileSync(join(migrationsDir, "0002_untracked.sql"), "SELECT 1;\n");
    rmSync(join(migrationsDir, "0001_missing.sql"));

    expect(checkMigrationJournal(migrationsDir)).toEqual([
      { message: "0001_missing.sql is missing" },
      { message: "0002_untracked.sql is not listed in _journal.json" },
    ]);
  });
});

const createMigrationsDir = (entries: unknown[]) => {
  const migrationsDir = mkdtempSync(join(tmpdir(), "hive-migrations-"));
  tempDirectories.push(migrationsDir);

  mkdirSync(join(migrationsDir, "meta"));
  writeFileSync(
    join(migrationsDir, "meta", "_journal.json"),
    `${JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, journalJsonIndent)}\n`
  );

  for (const entry of entries) {
    if (isJournalEntryFixture(entry)) {
      writeFileSync(join(migrationsDir, `${entry.tag}.sql`), "SELECT 1;\n");
    }
  }

  return migrationsDir;
};

const journalEntry = (idx: number, tag: string, when: number) => ({
  idx,
  version: "6",
  when,
  tag,
  breakpoints: true,
});

const generatedJournalEntry = (index: number) =>
  journalEntry(
    index,
    index === knownExceptionIndex
      ? "0013_gigantic_blonde_phantom"
      : `${String(index).padStart(migrationIndexWidth, "0")}_migration`,
    index === knownExceptionIndex
      ? knownExceptionTimestamp
      : generatedTimestampBase + index * generatedTimestampStep
  );

const isJournalEntryFixture = (
  entry: unknown
): entry is ReturnType<typeof journalEntry> =>
  Boolean(entry) &&
  typeof entry === "object" &&
  typeof (entry as ReturnType<typeof journalEntry>).tag === "string";
