import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { findConfigPath, PREFERRED_CONFIG_FILENAME } from "../config/files";

const REGISTRY_FILE_NAME = "workspaces.json";
const HIVE_HOME_ENV = "HIVE_HOME";
const REGISTRY_VERSION = 1;

export type WorkspaceRecord = {
  id: string;
  label: string;
  path: string;
  addedAt: string;
  lastOpenedAt?: string;
};

type RegistryFile = {
  version: number;
  workspaces: WorkspaceRecord[];
  activeWorkspaceId?: string | null;
};

export type WorkspaceRegistry = {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId?: string | null;
};

type RegisterWorkspaceInput = {
  path: string;
  label?: string;
};

type RegisterWorkspaceOptions = {
  setActive?: boolean;
};

type UpdateWorkspaceLabelInput = {
  id: string;
  label: string;
};

export function resolveHiveHome(): string {
  return process.env[HIVE_HOME_ENV] || join(homedir(), ".hive");
}

export function resolveCellsRoot(): string {
  return join(resolveHiveHome(), "cells");
}

export function isCellWorkspacePath(path: string): boolean {
  const cellsRoot = resolve(resolveCellsRoot());
  const normalizedPath = resolve(path);
  return (
    normalizedPath === cellsRoot ||
    normalizedPath.startsWith(`${cellsRoot}${sep}`)
  );
}

function resolveRegistryPath(): string {
  return join(resolveHiveHome(), REGISTRY_FILE_NAME);
}

async function ensureRegistryDir(): Promise<void> {
  const hiveHome = resolveHiveHome();
  await mkdir(hiveHome, { recursive: true });
}

function normalizePath(path: string): string {
  return resolve(path);
}

async function validateWorkspaceDirectory(path: string): Promise<string> {
  const absolutePath = normalizePath(path);
  let stats: Awaited<ReturnType<typeof stat>>;

  try {
    stats = await stat(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Workspace path does not exist: ${absolutePath} (${message})`
    );
  }

  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${absolutePath}`);
  }

  if (isCellWorkspacePath(absolutePath)) {
    throw new Error("Cell worktrees cannot be registered as workspaces");
  }

  const configPath = findConfigPath(absolutePath);
  if (!configPath) {
    throw new Error(
      `Hive config not found in ${absolutePath}. Add ${PREFERRED_CONFIG_FILENAME}.`
    );
  }

  try {
    await access(configPath);
  } catch {
    throw new Error(`Hive config is not readable at ${configPath}`);
  }

  return absolutePath;
}

async function readRegistryFile(): Promise<RegistryFile> {
  const registryPath = resolveRegistryPath();

  try {
    const contents = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(contents) as Partial<RegistryFile>;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid registry format");
    }

    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
          .map((workspace) => sanitizeWorkspaceRecord(workspace))
          .filter((record): record is WorkspaceRecord => Boolean(record))
      : [];

    const activeWorkspaceId =
      typeof parsed.activeWorkspaceId === "string" &&
      workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
        ? parsed.activeWorkspaceId
        : null;

    return {
      version:
        typeof parsed.version === "number" ? parsed.version : REGISTRY_VERSION,
      workspaces,
      activeWorkspaceId,
    };
  } catch (error) {
    if (isFileMissingError(error)) {
      return {
        version: REGISTRY_VERSION,
        workspaces: [],
        activeWorkspaceId: null,
      };
    }

    // biome-ignore lint/suspicious/noConsole: server-side diagnostic logging
    console.error("registry:read:error", { error });
    throw new Error(
      `Failed to read workspace registry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function writeRegistryFile(data: RegistryFile): Promise<void> {
  const registryPath = resolveRegistryPath();
  await ensureRegistryDir();
  await writeFile(registryPath, JSON.stringify(data, null, 2));
}

function isFileMissingError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}

function sanitizeWorkspaceRecord(record: unknown): WorkspaceRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const { id, label, path, addedAt, lastOpenedAt } =
    record as Partial<WorkspaceRecord>;
  if (!(id && label)) {
    return null;
  }
  if (!(path && addedAt)) {
    return null;
  }

  return {
    id,
    label,
    path,
    addedAt,
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
  };
}

function mergeWorkspace(
  existing: WorkspaceRecord | undefined,
  update: Partial<WorkspaceRecord>
): WorkspaceRecord {
  return {
    id: existing?.id ?? randomUUID(),
    label: update.label ?? existing?.label ?? "",
    path: update.path ?? existing?.path ?? "",
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    lastOpenedAt: update.lastOpenedAt ?? existing?.lastOpenedAt,
  };
}

function deriveLabelFromPath(path: string): string {
  const base = basename(path);
  return base || path;
}

function sortWorkspaces(workspaces: WorkspaceRecord[]): WorkspaceRecord[] {
  return [...workspaces].sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) {
      return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
    }
    if (a.lastOpenedAt) {
      return -1;
    }
    if (b.lastOpenedAt) {
      return 1;
    }
    return b.addedAt.localeCompare(a.addedAt);
  });
}

export async function getWorkspaceRegistry(): Promise<WorkspaceRegistry> {
  const registry = await readRegistryFile();
  const workspaces = sortWorkspaces(registry.workspaces);
  const activeWorkspaceId =
    registry.activeWorkspaceId ?? workspaces[0]?.id ?? null;

  if (!registry.activeWorkspaceId && activeWorkspaceId) {
    // biome-ignore lint/suspicious/noConsole: server-side diagnostic logging
    console.warn("registry:auto-activate", {
      chosen: activeWorkspaceId,
      workspaceCount: workspaces.length,
    });
    await writeRegistryFile({
      version: REGISTRY_VERSION,
      workspaces,
      activeWorkspaceId,
    });
  }

  // biome-ignore lint/suspicious/noConsole: server-side diagnostic logging
  console.debug("registry:get", {
    workspaceCount: workspaces.length,
    activeWorkspaceId,
  });

  return {
    workspaces,
    activeWorkspaceId,
  };
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const registry = await getWorkspaceRegistry();
  return registry.workspaces;
}

export async function registerWorkspace(
  input: RegisterWorkspaceInput,
  options: RegisterWorkspaceOptions = {}
): Promise<WorkspaceRecord> {
  const absolutePath = await validateWorkspaceDirectory(input.path);
  const registry = await readRegistryFile();
  const now = new Date().toISOString();
  const existing = registry.workspaces.find(
    (entry) => entry.path === absolutePath
  );
  const label =
    input.label?.trim() || existing?.label || deriveLabelFromPath(absolutePath);

  const workspace = mergeWorkspace(existing, {
    label,
    path: absolutePath,
    lastOpenedAt: options.setActive ? now : existing?.lastOpenedAt,
  });

  let workspaceWithAddedAt: WorkspaceRecord = workspace;
  if (!existing) {
    workspaceWithAddedAt = { ...workspace, addedAt: now };
  }

  const workspaces = existing
    ? registry.workspaces.map((entry) =>
        entry.id === workspaceWithAddedAt.id ? workspaceWithAddedAt : entry
      )
    : [...registry.workspaces, workspaceWithAddedAt];

  let activeWorkspaceId = registry.activeWorkspaceId ?? null;
  if (options.setActive || registry.workspaces.length === 0) {
    activeWorkspaceId = workspaceWithAddedAt.id;
  }

  await writeRegistryFile({
    version: REGISTRY_VERSION,
    workspaces,
    activeWorkspaceId,
  });
  return workspaceWithAddedAt;
}

export async function removeWorkspace(id: string): Promise<boolean> {
  const registry = await readRegistryFile();
  const initialLength = registry.workspaces.length;
  const workspaces = registry.workspaces.filter(
    (workspace) => workspace.id !== id
  );

  if (workspaces.length === initialLength) {
    return false;
  }

  let activeWorkspaceId = registry.activeWorkspaceId ?? null;
  if (activeWorkspaceId === id) {
    activeWorkspaceId = workspaces[0]?.id ?? null;
  }

  await writeRegistryFile({
    version: REGISTRY_VERSION,
    workspaces,
    activeWorkspaceId,
  });
  return true;
}

export async function updateWorkspaceLabel({
  id,
  label,
}: UpdateWorkspaceLabelInput): Promise<WorkspaceRecord | null> {
  const registry = await readRegistryFile();
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error("Workspace label cannot be empty");
  }

  const index = registry.workspaces.findIndex(
    (workspace) => workspace.id === id
  );
  if (index === -1) {
    return null;
  }

  const currentWorkspace = registry.workspaces[index];
  if (!currentWorkspace) {
    return null;
  }

  const updatedWorkspace: WorkspaceRecord = {
    ...currentWorkspace,
    label: trimmedLabel,
  };

  registry.workspaces[index] = updatedWorkspace;
  await writeRegistryFile({
    version: REGISTRY_VERSION,
    workspaces: registry.workspaces,
    activeWorkspaceId: registry.activeWorkspaceId ?? null,
  });
  return updatedWorkspace;
}

export async function activateWorkspace(
  id: string
): Promise<WorkspaceRecord | null> {
  const registry = await readRegistryFile();
  const index = registry.workspaces.findIndex(
    (workspace) => workspace.id === id
  );
  if (index === -1) {
    return null;
  }

  const currentWorkspace = registry.workspaces[index];
  if (!currentWorkspace) {
    return null;
  }

  const now = new Date().toISOString();
  const updatedWorkspace: WorkspaceRecord = {
    ...currentWorkspace,
    lastOpenedAt: now,
  };

  registry.workspaces[index] = updatedWorkspace;
  await writeRegistryFile({
    version: REGISTRY_VERSION,
    workspaces: registry.workspaces,
    activeWorkspaceId: updatedWorkspace.id,
  });
  return updatedWorkspace;
}

type EnsureWorkspaceOptions = {
  label?: string;
  preserveActiveWorkspace?: boolean;
};

export async function ensureWorkspaceRegistered(
  path: string,
  options: EnsureWorkspaceOptions = {}
): Promise<WorkspaceRecord> {
  const setActive = options.preserveActiveWorkspace
    ? await shouldActivateWorkspace(path)
    : true;

  return await registerWorkspace({ path, label: options.label }, { setActive });
}

async function shouldActivateWorkspace(path: string): Promise<boolean> {
  const registry = await readRegistryFile();

  if (registry.workspaces.length === 0) {
    return true;
  }

  if (!registry.activeWorkspaceId) {
    return true;
  }

  const normalizedPath = normalizePath(path);
  const existing = registry.workspaces.find(
    (entry) => entry.path === normalizedPath
  );

  if (!existing) {
    return false;
  }

  return registry.activeWorkspaceId === existing.id;
}

export type WorkspaceRegistryError = {
  readonly _tag: "WorkspaceRegistryError";
  readonly message: string;
  readonly cause?: unknown;
};

export type WorkspaceRegistryService = {
  readonly getRegistry: () => Promise<WorkspaceRegistry>;
  readonly listWorkspaces: () => Promise<WorkspaceRecord[]>;
  readonly registerWorkspace: (
    input: RegisterWorkspaceInput,
    options?: RegisterWorkspaceOptions
  ) => Promise<WorkspaceRecord>;
  readonly removeWorkspace: (id: string) => Promise<boolean>;
  readonly updateWorkspaceLabel: (
    input: UpdateWorkspaceLabelInput
  ) => Promise<WorkspaceRecord | null>;
  readonly activateWorkspace: (id: string) => Promise<WorkspaceRecord | null>;
  readonly ensureWorkspaceRegistered: (
    path: string,
    options?: EnsureWorkspaceOptions
  ) => Promise<WorkspaceRecord>;
};

const createWorkspaceRegistryService = (): WorkspaceRegistryService => ({
  getRegistry: () => getWorkspaceRegistry(),
  listWorkspaces: () => listWorkspaces(),
  registerWorkspace: (input, options) => registerWorkspace(input, options),
  removeWorkspace: (id) => removeWorkspace(id),
  updateWorkspaceLabel: (input) => updateWorkspaceLabel(input),
  activateWorkspace: (id) => activateWorkspace(id),
  ensureWorkspaceRegistered: (path, options) =>
    ensureWorkspaceRegistered(path, options),
});

export const workspaceRegistryService = createWorkspaceRegistryService();
