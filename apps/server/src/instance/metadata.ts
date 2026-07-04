import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveHiveHome } from "../workspaces/registry";

const INSTANCE_FILE_NAME = "instance.json";
const INSTANCE_METADATA_VERSION = 1;

type HiveInstanceMode = "local" | "shared";

type HiveInstanceMetadata = {
  id: string;
  name: string;
  mode: HiveInstanceMode;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

type PersistedInstanceMetadata = Partial<HiveInstanceMetadata> & {
  version?: number;
};

const readErrorCode = (error: unknown) => {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : null;
};

const normalizeInstanceMode = (value: string | undefined): HiveInstanceMode =>
  value === "shared" ? "shared" : "local";

const defaultInstanceName = (mode: HiveInstanceMode) =>
  mode === "shared" ? "Shared Hive" : "Local Hive";

const resolveInstanceMetadataPath = () =>
  process.env.HIVE_INSTANCE_METADATA_FILE ??
  join(resolveHiveHome(), INSTANCE_FILE_NAME);

function sanitizePersistedMetadata(
  parsed: PersistedInstanceMetadata,
  rootPath: string
): HiveInstanceMetadata | null {
  if (!(parsed.id && parsed.createdAt)) {
    return null;
  }

  const mode = normalizeInstanceMode(parsed.mode);
  const name =
    process.env.HIVE_INSTANCE_NAME?.trim() ||
    parsed.name?.trim() ||
    defaultInstanceName(mode);

  return {
    id: parsed.id,
    name,
    mode,
    rootPath,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt ?? parsed.createdAt,
  };
}

async function readPersistedMetadata(
  path: string,
  rootPath: string
): Promise<HiveInstanceMetadata | null> {
  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as PersistedInstanceMetadata;
    if (!(parsed && typeof parsed === "object")) {
      return null;
    }

    return sanitizePersistedMetadata(parsed, rootPath);
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }

    throw new Error(
      `Failed to read Hive instance metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function writePersistedMetadata(
  path: string,
  metadata: HiveInstanceMetadata
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ version: INSTANCE_METADATA_VERSION, ...metadata }, null, 2)
  );
}

export async function getHiveInstanceMetadata(): Promise<HiveInstanceMetadata> {
  const rootPath = resolveHiveHome();
  const metadataPath = resolveInstanceMetadataPath();
  const existing = await readPersistedMetadata(metadataPath, rootPath);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const mode = normalizeInstanceMode(process.env.HIVE_INSTANCE_MODE);
  const metadata: HiveInstanceMetadata = {
    id: randomUUID(),
    name: process.env.HIVE_INSTANCE_NAME?.trim() || defaultInstanceName(mode),
    mode,
    rootPath,
    createdAt: now,
    updatedAt: now,
  };

  await writePersistedMetadata(metadataPath, metadata);
  return metadata;
}
