import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("./migrations", import.meta.url)
);
const PRE_ORPHAN_CLEANUP_MIGRATION_INDEX = 15;
const VALID_SERVICE_PORT = 31_337;
const ORPHAN_SERVICE_PORT = 31_338;
const MISSING_SERVICE_PORT = 31_339;

type MigrationEntry = {
  idx: number;
  tag: string;
  when: number;
};

const loadMigrations = async () => {
  const journal = JSON.parse(
    await readFile(`${migrationsDirectory}/meta/_journal.json`, "utf8")
  ) as { entries: MigrationEntry[] };
  return await Promise.all(
    journal.entries.map(async (entry) => {
      const sql = await readFile(
        `${migrationsDirectory}/${entry.tag}.sql`,
        "utf8"
      );
      return { ...entry, sql };
    })
  );
};

const applyMigrationsThrough = (
  sqlite: Database,
  migrations: Awaited<ReturnType<typeof loadMigrations>>,
  lastIndex: number
) => {
  const applied = migrations.filter((migration) => migration.idx <= lastIndex);
  for (const migration of applied) {
    sqlite.exec(migration.sql);
  }

  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
  const insert = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)"
  );
  for (const migration of applied) {
    insert.run(
      createHash("sha256").update(migration.sql).digest("hex"),
      migration.when
    );
  }
};

const insertCell = (sqlite: Database, id: string) => {
  sqlite
    .prepare(
      `INSERT INTO cells (
        id, name, template_id, workspace_path, workspace_id,
        workspace_root_path, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, id, "template", `/tmp/${id}`, "workspace", "/tmp", 1, "ready");
};

const insertService = (sqlite: Database, id: string, cellId: string) => {
  sqlite
    .prepare(
      `INSERT INTO cell_services (
        id, cell_id, name, type, command, cwd, env, status,
        definition, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      cellId,
      "web",
      "process",
      "bun dev",
      "/tmp",
      "{}",
      "stopped",
      '{"type":"process","run":"bun dev"}',
      1,
      1
    );
};

describe("database migration safety", () => {
  it("preserves child records when upgrading a populated historical schema", async () => {
    const sqlite = new Database(":memory:");
    try {
      const migrations = await loadMigrations();
      applyMigrationsThrough(sqlite, migrations, 2);
      insertCell(sqlite, "historical-cell");
      insertService(sqlite, "historical-service", "historical-cell");
      sqlite
        .prepare(
          "INSERT INTO cell_provisioning_state (cell_id, attempt_count) VALUES (?, ?)"
        )
        .run("historical-cell", 1);

      await migrate(drizzle(sqlite), { migrationsFolder: migrationsDirectory });
      sqlite.exec("PRAGMA foreign_keys = ON;");

      expect(
        sqlite.query("SELECT id FROM cells WHERE id = 'historical-cell'").get()
      ).toBeDefined();
      expect(
        sqlite
          .query("SELECT id FROM cell_services WHERE id = 'historical-service'")
          .get()
      ).toBeDefined();
      expect(
        sqlite
          .query(
            "SELECT cell_id FROM cell_provisioning_state WHERE cell_id = 'historical-cell'"
          )
          .get()
      ).toBeDefined();
      expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("removes orphaned service and port rows during upgrade", async () => {
    const sqlite = new Database(":memory:");
    try {
      const migrations = await loadMigrations();
      applyMigrationsThrough(
        sqlite,
        migrations,
        PRE_ORPHAN_CLEANUP_MIGRATION_INDEX
      );
      sqlite.exec("PRAGMA foreign_keys = OFF;");
      insertCell(sqlite, "valid-cell");
      insertService(sqlite, "valid-service", "valid-cell");
      insertService(sqlite, "orphan-service", "missing-cell");
      sqlite
        .prepare(
          "INSERT INTO cell_provisioning_state (cell_id, attempt_count) VALUES (?, ?)"
        )
        .run("missing-cell", 1);

      const insertActivity = sqlite.prepare(
        `INSERT INTO cell_activity_events (
          id, cell_id, service_id, type, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );
      insertActivity.run(
        "valid-activity",
        "valid-cell",
        "valid-service",
        "service.stop",
        "{}",
        1
      );
      insertActivity.run(
        "orphan-cell-activity",
        "missing-cell",
        null,
        "service.stop",
        "{}",
        1
      );
      insertActivity.run(
        "orphan-service-activity",
        "valid-cell",
        "missing-service",
        "service.stop",
        "{}",
        1
      );
      insertActivity.run(
        "orphan-owned-service-activity",
        "valid-cell",
        "orphan-service",
        "service.stop",
        "{}",
        1
      );

      const insertPort = sqlite.prepare(
        `INSERT INTO cell_service_ports (
          service_id, name, port, is_primary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );
      insertPort.run("valid-service", "http", VALID_SERVICE_PORT, 1, 1, 1);
      insertPort.run("orphan-service", "http", ORPHAN_SERVICE_PORT, 1, 1, 1);
      insertPort.run("missing-service", "http", MISSING_SERVICE_PORT, 1, 1, 1);

      await migrate(drizzle(sqlite), { migrationsFolder: migrationsDirectory });
      sqlite.exec("PRAGMA foreign_keys = ON;");

      expect(
        sqlite.query("SELECT id FROM cell_services ORDER BY id").all()
      ).toEqual([{ id: "valid-service" }]);
      expect(
        sqlite.query("SELECT id FROM cell_activity_events ORDER BY id").all()
      ).toEqual([{ id: "valid-activity" }]);
      expect(
        sqlite.query("SELECT cell_id FROM cell_provisioning_state").all()
      ).toEqual([]);
      expect(
        sqlite
          .query(
            "SELECT service_id, port FROM cell_service_ports ORDER BY port"
          )
          .all()
      ).toEqual([{ service_id: "valid-service", port: VALID_SERVICE_PORT }]);
      expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
