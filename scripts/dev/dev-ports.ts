import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const PROJECT_ROOT = process.cwd();
const API_BASE_PORT = 4300;
const PORT_PAIR_COUNT = 250;
const HASH_HEX_SLICE_LENGTH = 8;
const HEX_RADIX = 16;
const OUTPUT_DIR = resolve(PROJECT_ROOT, ".hive");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "dev-ports.json");

const isPortAvailable = async (port: number): Promise<boolean> =>
  new Promise((resolveAvailable) => {
    const server = createServer();

    server.once("error", () => {
      resolveAvailable(false);
    });

    server.listen(port, "127.0.0.1", () => {
      server.close(() => {
        resolveAvailable(true);
      });
    });
  });

const hashProjectRoot = (input: string): number => {
  const digest = createHash("sha256").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, HASH_HEX_SLICE_LENGTH), HEX_RADIX);
};

const selectPortPair = async () => {
  const existingPair = await loadExistingPortPair();

  if (existingPair) {
    return existingPair;
  }

  const seed = hashProjectRoot(PROJECT_ROOT);

  for (let offset = 0; offset < PORT_PAIR_COUNT; offset += 1) {
    const slot = (seed + offset) % PORT_PAIR_COUNT;
    const apiPort = API_BASE_PORT + slot * 2;
    const webPort = apiPort + 1;

    const [apiAvailable, webAvailable] = await Promise.all([
      isPortAvailable(apiPort),
      isPortAvailable(webPort),
    ]);

    if (apiAvailable && webAvailable) {
      return { apiPort, webPort };
    }
  }

  throw new Error(
    `Unable to find an available dev port pair in range ${API_BASE_PORT}-${API_BASE_PORT + PORT_PAIR_COUNT * 2}.`
  );
};

const persistPorts = async (apiPort: number, webPort: number) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      {
        apiPort,
        webPort,
        apiUrl: `http://127.0.0.1:${apiPort}`,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
};

const loadExistingPortPair = async () => {
  try {
    const raw = await readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw) as {
      apiPort?: number;
      webPort?: number;
    };

    if (!(parsed.apiPort && parsed.webPort)) {
      return null;
    }

    const [apiAvailable, webAvailable] = await Promise.all([
      isPortAvailable(parsed.apiPort),
      isPortAvailable(parsed.webPort),
    ]);

    return apiAvailable && webAvailable
      ? { apiPort: parsed.apiPort, webPort: parsed.webPort }
      : null;
  } catch {
    return null;
  }
};

const renderShell = (apiPort: number, webPort: number) => {
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  return [
    `export HIVE_DEV_API_PORT=${apiPort}`,
    `export HIVE_DEV_WEB_PORT=${webPort}`,
    `export HIVE_DEV_API_URL=${apiUrl}`,
    `export VITE_API_URL=${apiUrl}`,
  ].join("\n");
};

const main = async () => {
  const [mode] = Bun.argv.slice(2);
  const { apiPort, webPort } = await selectPortPair();
  await persistPorts(apiPort, webPort);

  if (mode === "--shell") {
    process.stdout.write(`${renderShell(apiPort, webPort)}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        apiPort,
        webPort,
        apiUrl: `http://127.0.0.1:${apiPort}`,
      },
      null,
      2
    )}\n`
  );
};

await main();
