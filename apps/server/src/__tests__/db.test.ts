import { beforeAll, describe, expect, it } from "vitest";

describe("Database", () => {
  beforeAll(() => {
    // Set test DATABASE_URL if not already set
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = ":memory:";
    }
  });

  it("should initialize db client without errors", async () => {
    const { db } = await import("../db");
    expect(db).toBeDefined();
    expect(db).toHaveProperty("query");
  });

  it("should have database client methods", async () => {
    const { db } = await import("../db");
    expect(db).toHaveProperty("insert");
    expect(db).toHaveProperty("update");
    expect(db).toHaveProperty("delete");
    expect(db).toHaveProperty("select");
  });
});
