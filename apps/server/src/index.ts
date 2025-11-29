import { startServer } from "./server";

startServer().catch((error) => {
  process.stderr.write(
    `Failed to start Hive server: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`
  );
  process.exit(1);
});
