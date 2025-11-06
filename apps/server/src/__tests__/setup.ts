import { afterAll, beforeAll } from "vitest";

// Set up test environment variables
beforeAll(() => {
  process.env.DATABASE_URL = "file::memory:";
});

afterAll(() => {
  // Clean up if needed
});
