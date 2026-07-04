import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_VERSION = 1;
const LOCAL_INSTANCE_NAME = "local";
const INSTANCE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export type HiveInstanceProfile = {
  name: string;
  apiUrl: string;
  webUrl: string;
  tokenEnv?: string;
  addedAt: string;
  lastUsedAt?: string;
};

type HiveInstanceRegistry = {
  activeName: string;
  profiles: HiveInstanceProfile[];
};

type InstanceConfigFile = {
  version: number;
  activeName?: string | null;
  instances?: unknown[];
};

type InstanceStoreOptions = {
  configPath: string;
  localApiUrl: string;
  localWebUrl: string;
  now?: () => Date;
};

type AddInstanceInput = {
  name: string;
  apiUrl: string;
  webUrl?: string;
  tokenEnv?: string;
  setActive?: boolean;
};

export const resolveInstanceConfigPath = (hiveHome: string) =>
  process.env.HIVE_INSTANCE_CONFIG ?? join(hiveHome, "instances.json");

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const normalizeInstanceName = (value: string) => {
  const name = value.trim();
  if (!name) {
    throw new Error("Instance name is required");
  }
  if (!INSTANCE_NAME_PATTERN.test(name)) {
    throw new Error(
      "Instance name may only contain letters, numbers, dots, underscores, and dashes"
    );
  }
  return name;
};

const normalizeInstanceUrl = (value: string, label: string) => {
  const input = value.trim();
  if (!input) {
    throw new Error(`${label} is required`);
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }

  return trimTrailingSlash(parsed.toString());
};

const createLocalProfile = (
  options: InstanceStoreOptions
): HiveInstanceProfile => ({
  name: LOCAL_INSTANCE_NAME,
  apiUrl: trimTrailingSlash(options.localApiUrl),
  webUrl: trimTrailingSlash(options.localWebUrl),
  addedAt: "built-in",
});

const sanitizeProfile = (record: unknown): HiveInstanceProfile | null => {
  if (!(record && typeof record === "object")) {
    return null;
  }

  const profile = record as Partial<HiveInstanceProfile>;
  if (!(profile.name && profile.apiUrl && profile.addedAt)) {
    return null;
  }

  try {
    const name = normalizeInstanceName(profile.name);
    if (name === LOCAL_INSTANCE_NAME) {
      return null;
    }
    return {
      name,
      apiUrl: normalizeInstanceUrl(profile.apiUrl, "API URL"),
      webUrl: normalizeInstanceUrl(profile.webUrl ?? profile.apiUrl, "Web URL"),
      ...(profile.tokenEnv ? { tokenEnv: profile.tokenEnv } : {}),
      addedAt: profile.addedAt,
      ...(profile.lastUsedAt ? { lastUsedAt: profile.lastUsedAt } : {}),
    };
  } catch {
    return null;
  }
};

const readConfigFile = (configPath: string): InstanceConfigFile => {
  if (!existsSync(configPath)) {
    return {
      version: CONFIG_VERSION,
      activeName: LOCAL_INSTANCE_NAME,
      instances: [],
    };
  }

  const parsed = JSON.parse(
    readFileSync(configPath, "utf8")
  ) as Partial<InstanceConfigFile>;
  return {
    version:
      typeof parsed.version === "number" ? parsed.version : CONFIG_VERSION,
    activeName:
      typeof parsed.activeName === "string" ? parsed.activeName : null,
    instances: Array.isArray(parsed.instances) ? parsed.instances : [],
  };
};

const writeConfigFile = (
  options: InstanceStoreOptions,
  config: InstanceConfigFile
) => {
  mkdirSync(dirname(options.configPath), { recursive: true });
  writeFileSync(
    options.configPath,
    JSON.stringify(
      {
        version: CONFIG_VERSION,
        activeName: config.activeName ?? LOCAL_INSTANCE_NAME,
        instances: (config.instances ?? []).filter(
          (entry): entry is HiveInstanceProfile =>
            Boolean(entry && typeof entry === "object")
        ),
      },
      null,
      2
    )
  );
};

const getStoredProfiles = (options: InstanceStoreOptions) =>
  (readConfigFile(options.configPath).instances ?? [])
    .map((record) => sanitizeProfile(record))
    .filter((profile): profile is HiveInstanceProfile => Boolean(profile));

export const getInstanceRegistry = (
  options: InstanceStoreOptions
): HiveInstanceRegistry => {
  const config = readConfigFile(options.configPath);
  const localProfile = createLocalProfile(options);
  const storedProfiles = (config.instances ?? [])
    .map((record) => sanitizeProfile(record))
    .filter((profile): profile is HiveInstanceProfile => Boolean(profile));
  const profiles = [localProfile, ...storedProfiles];
  const activeName = profiles.some(
    (profile) => profile.name === config.activeName
  )
    ? (config.activeName as string)
    : LOCAL_INSTANCE_NAME;

  return { activeName, profiles };
};

export const resolveInstanceProfile = (
  options: InstanceStoreOptions,
  name?: string
) => {
  const registry = getInstanceRegistry(options);
  const targetName = name ? normalizeInstanceName(name) : registry.activeName;
  const profile = registry.profiles.find((entry) => entry.name === targetName);
  if (!profile) {
    throw new Error(`Unknown Hive instance "${targetName}"`);
  }
  return { profile, registry };
};

export const isLocalInstanceProfile = (profile: HiveInstanceProfile) =>
  profile.name === LOCAL_INSTANCE_NAME;

export const addInstanceProfile = (
  options: InstanceStoreOptions,
  input: AddInstanceInput
) => {
  const name = normalizeInstanceName(input.name);
  if (name === LOCAL_INSTANCE_NAME) {
    throw new Error("The built-in local instance cannot be replaced");
  }

  const apiUrl = normalizeInstanceUrl(input.apiUrl, "API URL");
  const webUrl = normalizeInstanceUrl(input.webUrl ?? input.apiUrl, "Web URL");
  const now = (options.now ?? (() => new Date()))().toISOString();
  const storedProfiles = getStoredProfiles(options);
  const existing = storedProfiles.find((entry) => entry.name === name);
  const profile: HiveInstanceProfile = {
    name,
    apiUrl,
    webUrl,
    ...(input.tokenEnv?.trim() ? { tokenEnv: input.tokenEnv.trim() } : {}),
    addedAt: existing?.addedAt ?? now,
    lastUsedAt: input.setActive ? now : existing?.lastUsedAt,
  };
  const instances = existing
    ? storedProfiles.map((entry) => (entry.name === name ? profile : entry))
    : [...storedProfiles, profile];
  const current = readConfigFile(options.configPath);

  writeConfigFile(options, {
    version: CONFIG_VERSION,
    activeName: input.setActive
      ? name
      : (current.activeName ?? LOCAL_INSTANCE_NAME),
    instances,
  });

  return profile;
};

export const activateInstanceProfile = (
  options: InstanceStoreOptions,
  name: string
) => {
  const targetName = normalizeInstanceName(name);
  const { profile } = resolveInstanceProfile(options, targetName);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const storedProfiles = getStoredProfiles(options).map((entry) =>
    entry.name === targetName ? { ...entry, lastUsedAt: now } : entry
  );

  writeConfigFile(options, {
    version: CONFIG_VERSION,
    activeName: profile.name,
    instances: storedProfiles,
  });

  return profile;
};

export const removeInstanceProfile = (
  options: InstanceStoreOptions,
  name: string
) => {
  const targetName = normalizeInstanceName(name);
  if (targetName === LOCAL_INSTANCE_NAME) {
    throw new Error("The built-in local instance cannot be removed");
  }

  const current = readConfigFile(options.configPath);
  const storedProfiles = getStoredProfiles(options);
  const instances = storedProfiles.filter(
    (profile) => profile.name !== targetName
  );
  if (instances.length === storedProfiles.length) {
    return false;
  }

  writeConfigFile(options, {
    version: CONFIG_VERSION,
    activeName:
      current.activeName === targetName
        ? LOCAL_INSTANCE_NAME
        : (current.activeName ?? LOCAL_INSTANCE_NAME),
    instances,
  });
  return true;
};
