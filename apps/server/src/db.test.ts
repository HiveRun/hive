import type { Database } from "bun:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

describe("Database", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = ":memory:";
    }
  });

  it("initializes a Bun-powered sqlite client", async () => {
    const { db } = await import("./db");
    expect(db).toBeDefined();
    expect(db).toHaveProperty("query");
    expect(db).toHaveProperty("insert");
    expect(db).toHaveProperty("select");
  });

  it("executes queries end-to-end", async () => {
    const { db } = await import("./db");
    const client = (db as typeof db & { $client: Database }).$client;
    const row = client.query("select 'hello world' as text").get() as {
      text: string;
    };
    expect(row.text).toBe("hello world");
  });
});
