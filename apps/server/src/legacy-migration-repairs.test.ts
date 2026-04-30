import { Database } from "bun:sqlite";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { describe, expect, it } from "vitest";
import { repairLegacyMigrationGaps } from "./legacy-migration-repairs";
import { schema } from "./schema";

const createTestDb = () => {
  const sqlite = new Database(":memory:");
  const database = drizzle(sqlite, { schema });

  return { database, sqlite };
};

const readColumnNames = (
  database: ReturnType<typeof createTestDb>["database"]
) =>
  database
    .all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info(${"cell_provisioning_state"})`
    )
    .map((column) => column.name);

const createDrizzleMigrationsTable = (sqlite: Database) => {
  sqlite.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);
};

describe("repairLegacyMigrationGaps", () => {
  it("adds the skipped initial prompt images column", () => {
    const { database, sqlite } = createTestDb();

    try {
      sqlite.exec(`
        CREATE TABLE cell_provisioning_state (
          cell_id text PRIMARY KEY,
          model_id_override text,
          provider_id_override text,
          variant_override text,
          start_mode text,
          started_at integer,
          finished_at integer,
          attempt_count integer NOT NULL DEFAULT 0
        );
      `);
      createDrizzleMigrationsTable(sqlite);
      sqlite.exec(`
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES ('0012', 1786000000000);
      `);

      const repairedGaps = repairLegacyMigrationGaps(database);

      expect(repairedGaps).toEqual([
        "cell_provisioning_state.initial_prompt_images_json",
      ]);
      expect(readColumnNames(database)).toContain("initial_prompt_images_json");
    } finally {
      sqlite.close();
    }
  });

  it("does not repair when Drizzle can still apply the skipped migration", () => {
    const { database, sqlite } = createTestDb();

    try {
      sqlite.exec(`
        CREATE TABLE cell_provisioning_state (
          cell_id text PRIMARY KEY
        );
      `);
      createDrizzleMigrationsTable(sqlite);
      sqlite.exec(`
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES ('0003', 1770414771713);
      `);

      expect(repairLegacyMigrationGaps(database)).toEqual([]);
      expect(readColumnNames(database)).not.toContain(
        "initial_prompt_images_json"
      );
    } finally {
      sqlite.close();
    }
  });

  it("does not alter databases that already have the column", () => {
    const { database, sqlite } = createTestDb();

    try {
      sqlite.exec(`
        CREATE TABLE cell_provisioning_state (
          cell_id text PRIMARY KEY,
          initial_prompt_images_json text
        );
      `);

      expect(repairLegacyMigrationGaps(database)).toEqual([]);
      expect(readColumnNames(database)).toContain("initial_prompt_images_json");
    } finally {
      sqlite.close();
    }
  });
});
