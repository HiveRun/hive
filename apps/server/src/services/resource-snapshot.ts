import pidusage from "pidusage";

const DEFAULT_CACHE_TTL_MS = 2000;
const CPU_PRECISION_DECIMALS = 3;
const SUPPORTED_PLATFORMS = new Set(["linux", "darwin", "win32"]);
const RSS_KB_TO_BYTES = 1024;
const PS_SEGMENT_MIN_LENGTH = 3;
const WHITESPACE_SPLIT_RE = /\s+/;
const CPU_PERCENT_SCALE = 100;

type PsSnapshot = {
  cpuPercent: number | null;
  rssBytes: number | null;
};

export type ResourceUnavailableReason =
  | "pid_missing"
  | "process_not_alive"
  | "sample_failed"
  | "unsupported_platform";

export type ProcessResourceSnapshot = {
  cpuPercent: number | null;
  rssBytes: number | null;
  resourceSampledAt: string;
  resourceUnavailableReason?: ResourceUnavailableReason;
};

type PidSample = {
  cpu?: number;
  memory?: number;
  ctime?: number;
  timestamp?: number;
};

type PidUsageResult = Record<string, PidSample>;

type ResourceSnapshotServiceOptions = {
  cacheTtlMs?: number;
  now?: () => number;
};

type CachedPidSnapshot = {
  expiresAt: number;
  snapshot: ProcessResourceSnapshot;
};

type CpuCounter = {
  ctime: number;
  timestamp: number;
};

const toUnavailable = (
  reason: ResourceUnavailableReason,
  sampledAt: string
): ProcessResourceSnapshot => ({
  cpuPercent: null,
  rssBytes: null,
  resourceSampledAt: sampledAt,
  resourceUnavailableReason: reason,
});

const toPidKey = (pid: number) => String(pid);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizePids = (pids: number[]): number[] =>
  Array.from(
    new Set(
      pids.filter(
        (pid) => Number.isInteger(pid) && Number.isFinite(pid) && pid > 0
      )
    )
  );

const snapshotFromStat = (
  stat: PidSample,
  sampledAtIso: string
): ProcessResourceSnapshot => {
  const cpu = isFiniteNumber(stat.cpu) ? Number(stat.cpu) : null;
  const memory = isFiniteNumber(stat.memory) ? Number(stat.memory) : null;
  const sampledAt = isFiniteNumber(stat.timestamp)
    ? new Date(stat.timestamp).toISOString()
    : sampledAtIso;

  return {
    cpuPercent:
      cpu == null ? null : Number(cpu.toFixed(CPU_PRECISION_DECIMALS)),
    rssBytes: memory,
    resourceSampledAt: sampledAt,
    ...(cpu != null || memory != null
      ? {}
      : { resourceUnavailableReason: "sample_failed" }),
  };
};

const parsePsSnapshots = (output: string): Map<number, PsSnapshot> => {
  const snapshots = new Map<number, PsSnapshot>();
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const segments = line.split(WHITESPACE_SPLIT_RE);
    if (segments.length < PS_SEGMENT_MIN_LENGTH) {
      continue;
    }

    const pid = Number(segments[0]);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }

    const cpuRaw = Number(segments[1]);
    const rssKbRaw = Number(segments[2]);
    const cpuPercent = Number.isFinite(cpuRaw)
      ? Number(cpuRaw.toFixed(CPU_PRECISION_DECIMALS))
      : null;
    const rssBytes = Number.isFinite(rssKbRaw)
      ? Math.max(0, Math.round(rssKbRaw * RSS_KB_TO_BYTES))
      : null;

    snapshots.set(pid, {
      cpuPercent,
      rssBytes,
    });
  }

  return snapshots;
};

const sampleWithPs = async (
  pids: number[]
): Promise<Map<number, PsSnapshot>> => {
  if (pids.length === 0 || process.platform === "win32") {
    return new Map<number, PsSnapshot>();
  }

  const child = Bun.spawn({
    cmd: ["ps", "-p", pids.join(","), "-o", "pid=,%cpu=,rss="],
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    return new Map<number, PsSnapshot>();
  }

  return parsePsSnapshots(output);
};

const mergeFallbackSnapshot = (
  primary: ProcessResourceSnapshot,
  fallback: PsSnapshot | undefined
): ProcessResourceSnapshot => {
  const cpuPercent =
    primary.cpuPercent != null && primary.cpuPercent > 0
      ? primary.cpuPercent
      : (fallback?.cpuPercent ?? primary.cpuPercent);
  const rssBytes = primary.rssBytes ?? fallback?.rssBytes ?? null;

  return {
    cpuPercent,
    rssBytes,
    resourceSampledAt: primary.resourceSampledAt,
    ...(cpuPercent != null || rssBytes != null
      ? {}
      : { resourceUnavailableReason: primary.resourceUnavailableReason }),
  };
};

const resolveDeltaCpuPercent = (args: {
  pid: number;
  stat: PidSample;
  nowMs: number;
  countersByPid: Map<number, CpuCounter>;
}): number | null => {
  const ctime = isFiniteNumber(args.stat.ctime) ? args.stat.ctime : null;
  if (ctime == null) {
    return null;
  }

  const previous = args.countersByPid.get(args.pid);
  args.countersByPid.set(args.pid, {
    ctime,
    timestamp: args.nowMs,
  });

  if (!previous) {
    return null;
  }

  const deltaMs = args.nowMs - previous.timestamp;
  const deltaCpuMs = ctime - previous.ctime;
  if (deltaMs <= 0 || deltaCpuMs <= 0) {
    return 0;
  }

  return Number(
    ((deltaCpuMs / deltaMs) * CPU_PERCENT_SCALE).toFixed(CPU_PRECISION_DECIMALS)
  );
};

const withCpuOverride = (
  snapshot: ProcessResourceSnapshot,
  cpuPercent: number | null
): ProcessResourceSnapshot =>
  cpuPercent == null
    ? snapshot
    : {
        ...snapshot,
        cpuPercent,
      };

export function createResourceSnapshotService(
  options: ResourceSnapshotServiceOptions = {}
) {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<number, CachedPidSnapshot>();
  const cpuCountersByPid = new Map<number, CpuCounter>();

  const cacheSnapshot = (pid: number, snapshot: ProcessResourceSnapshot) => {
    cache.set(pid, {
      snapshot,
      expiresAt: now() + cacheTtlMs,
    });
  };

  const readCachedSnapshots = (
    pids: number[],
    result: Map<number, ProcessResourceSnapshot>
  ): number[] => {
    const currentTime = now();
    const uncached: number[] = [];

    for (const pid of pids) {
      const cached = cache.get(pid);
      if (cached && cached.expiresAt > currentTime) {
        result.set(pid, cached.snapshot);
        continue;
      }
      uncached.push(pid);
    }

    return uncached;
  };

  const addUnavailable = (
    pids: number[],
    reason: ResourceUnavailableReason,
    sampledAtIso: string,
    result: Map<number, ProcessResourceSnapshot>
  ) => {
    for (const pid of pids) {
      const snapshot = toUnavailable(reason, sampledAtIso);
      result.set(pid, snapshot);
      cacheSnapshot(pid, snapshot);
    }
  };

  const sampleUncachedPids = async (
    uncachedPids: number[],
    sampledAtIso: string,
    result: Map<number, ProcessResourceSnapshot>
  ) => {
    try {
      const psSnapshots = await sampleWithPs(uncachedPids);
      const stats = (await pidusage(uncachedPids)) as PidUsageResult;
      for (const pid of uncachedPids) {
        const stat = stats[toPidKey(pid)];
        if (!stat) {
          const fallback = psSnapshots.get(pid);
          const snapshot = fallback
            ? {
                cpuPercent: fallback.cpuPercent,
                rssBytes: fallback.rssBytes,
                resourceSampledAt: sampledAtIso,
              }
            : toUnavailable("sample_failed", sampledAtIso);
          result.set(pid, snapshot);
          cacheSnapshot(pid, snapshot);
          continue;
        }

        const snapshotWithFallback = mergeFallbackSnapshot(
          snapshotFromStat(stat, sampledAtIso),
          psSnapshots.get(pid)
        );
        const deltaCpuPercent = resolveDeltaCpuPercent({
          pid,
          stat,
          nowMs: now(),
          countersByPid: cpuCountersByPid,
        });
        const snapshot = withCpuOverride(snapshotWithFallback, deltaCpuPercent);
        result.set(pid, snapshot);
        cacheSnapshot(pid, snapshot);
      }
    } catch {
      addUnavailable(uncachedPids, "sample_failed", sampledAtIso, result);
    }
  };

  const samplePids = async (
    pids: number[]
  ): Promise<Map<number, ProcessResourceSnapshot>> => {
    const sampledAtIso = new Date(now()).toISOString();
    const result = new Map<number, ProcessResourceSnapshot>();

    const normalizedPids = normalizePids(pids);

    if (normalizedPids.length === 0) {
      return result;
    }

    if (!SUPPORTED_PLATFORMS.has(process.platform)) {
      addUnavailable(
        normalizedPids,
        "unsupported_platform",
        sampledAtIso,
        result
      );
      return result;
    }

    const uncachedPids = readCachedSnapshots(normalizedPids, result);

    if (uncachedPids.length === 0) {
      return result;
    }

    await sampleUncachedPids(uncachedPids, sampledAtIso, result);

    return result;
  };

  return {
    samplePids,
  };
}
