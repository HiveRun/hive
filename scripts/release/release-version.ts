import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const manifestCandidates = [
  new URL("../../apps/desktop-electron/package.json", import.meta.url),
  new URL("../../package.json", import.meta.url),
];

export type ReleaseVersionSource = {
  version: string;
  source: string;
};

export const normalizeVersion = (value: string | undefined) => {
  if (!value) {
    return;
  }
  return value.startsWith("v") ? value.slice(1) : value;
};

const isValidSemver = (version: string) => SEMVER_PATTERN.test(version);

const readManifestVersion = async (
  manifestPath: URL
): Promise<ReleaseVersionSource | null> => {
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    return null;
  }

  const manifestRaw = await manifestFile.text();
  const manifest = JSON.parse(manifestRaw) as {
    name?: string;
    version?: string;
  };

  if (!(manifest.version && isValidSemver(manifest.version))) {
    return null;
  }

  return {
    version: manifest.version,
    source: manifest.name ?? fileURLToPath(manifestPath),
  };
};

export const readReleaseManifestVersions = async () => {
  const versions: ReleaseVersionSource[] = [];

  for (const manifestPath of manifestCandidates) {
    const versionSource = await readManifestVersion(manifestPath);
    if (versionSource) {
      versions.push(versionSource);
    }
  }

  return versions;
};

const readManifestVersionCandidates = async () => {
  const versions = await readReleaseManifestVersions();
  if (versions.length > 0) {
    return versions[0];
  }

  return null;
};

export const resolveReleaseVersion = async (options?: {
  envVersion?: string;
  fallbackVersion?: string;
}): Promise<ReleaseVersionSource> => {
  const envVersion = normalizeVersion(options?.envVersion);
  if (envVersion) {
    if (!isValidSemver(envVersion)) {
      throw new Error(
        `HIVE_VERSION is not valid semver: ${options?.envVersion ?? "<missing>"}`
      );
    }

    return {
      version: envVersion,
      source: "HIVE_VERSION",
    };
  }

  const versionSource = await readManifestVersionCandidates();
  if (versionSource) {
    return versionSource;
  }

  const fallbackVersion = normalizeVersion(options?.fallbackVersion);
  if (fallbackVersion) {
    if (!isValidSemver(fallbackVersion)) {
      throw new Error(
        `Fallback release version is not valid semver: ${options?.fallbackVersion ?? "<missing>"}`
      );
    }

    return {
      version: fallbackVersion,
      source: "fallback",
    };
  }

  throw new Error(
    "No valid release version found in apps/desktop-electron/package.json or package.json."
  );
};

export { repoRoot };
