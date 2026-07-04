const DEFAULT_INSTANCE_ROOT = "~/.hive";
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const WHITESPACE_PATTERN = /\s/;
const LINE_BREAK_PATTERN = /[\r\n]/;

const INSTANCE_DOCTOR_REQUIRED_TOOLS = ["git", "bun", "opencode"] as const;

export type InstanceDoctorOptions = {
  identityFile?: string | null;
  instanceRoot?: string | null;
  knownHostsFile?: string | null;
  port?: string | null;
  target?: string | null;
};

type InstanceDoctorConfig = {
  identityFile?: string;
  instanceRoot: string;
  knownHostsFile?: string;
  port?: number;
  target: string;
};

type ParsePortResult =
  | {
      ok: true;
      port: number;
    }
  | {
      ok: false;
      message: string;
    };

type ResolveInstanceDoctorConfigResult =
  | {
      ok: true;
      config: InstanceDoctorConfig;
    }
  | {
      ok: false;
      message: string;
    };

type NormalizeOptionalValueResult =
  | {
      ok: true;
      value?: string;
    }
  | {
      ok: false;
      message: string;
    };

const parsePort = (value: string, label: string): ParsePortResult => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return {
      ok: false,
      message: `${label} must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    };
  }

  return { ok: true, port };
};

const normalizeRequiredValue = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const validateNoLineBreaks = (value: string, label: string) => {
  if (LINE_BREAK_PATTERN.test(value)) {
    return `${label} must not contain line breaks.`;
  }

  return null;
};

const normalizeOptionalValueWithoutLineBreaks = (
  value: string | null | undefined,
  label: string
): NormalizeOptionalValueResult => {
  const normalized = normalizeRequiredValue(value);
  if (!normalized) {
    return { ok: true };
  }

  const error = validateNoLineBreaks(normalized, label);
  if (error) {
    return { ok: false, message: error };
  }

  return { ok: true, value: normalized };
};

export const quoteRemoteShellValue = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;

export const resolveInstanceDoctorConfig = (
  options: InstanceDoctorOptions
): ResolveInstanceDoctorConfigResult => {
  const target = normalizeRequiredValue(options.target);
  if (!target) {
    return { ok: false, message: "Pass an SSH target to inspect." };
  }

  if (target.startsWith("-") || WHITESPACE_PATTERN.test(target)) {
    return {
      ok: false,
      message:
        "SSH target must be an OpenSSH host alias or user@host without whitespace.",
    };
  }

  const portValue = normalizeRequiredValue(options.port);
  let port: number | undefined;
  if (portValue) {
    const portResult = parsePort(portValue, "SSH port");
    if (!portResult.ok) {
      return portResult;
    }
    port = portResult.port;
  }

  const instanceRoot =
    normalizeRequiredValue(options.instanceRoot) ?? DEFAULT_INSTANCE_ROOT;
  const instanceRootError = validateNoLineBreaks(instanceRoot, "Instance root");
  if (instanceRootError) {
    return { ok: false, message: instanceRootError };
  }

  const identityFileResult = normalizeOptionalValueWithoutLineBreaks(
    options.identityFile,
    "Identity file"
  );
  if (!identityFileResult.ok) {
    return identityFileResult;
  }

  const knownHostsFileResult = normalizeOptionalValueWithoutLineBreaks(
    options.knownHostsFile,
    "Known hosts file"
  );
  if (!knownHostsFileResult.ok) {
    return knownHostsFileResult;
  }

  return {
    ok: true,
    config: {
      ...(identityFileResult.value
        ? { identityFile: identityFileResult.value }
        : {}),
      ...(knownHostsFileResult.value
        ? { knownHostsFile: knownHostsFileResult.value }
        : {}),
      instanceRoot,
      ...(port ? { port } : {}),
      target,
    },
  };
};

export const buildInstanceDoctorSshArgs = (config: InstanceDoctorConfig) => {
  const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

  if (config.knownHostsFile) {
    args.push("-o", `UserKnownHostsFile=${config.knownHostsFile}`);
  }

  if (config.identityFile) {
    args.push("-o", "IdentitiesOnly=yes");
  }

  if (config.port) {
    args.push("-p", String(config.port));
  }

  if (config.identityFile) {
    args.push("-i", config.identityFile);
  }

  args.push(
    config.target,
    `HIVE_INSTANCE_ROOT=${quoteRemoteShellValue(config.instanceRoot)} sh -s`
  );

  return args;
};

export const buildInstanceDoctorScript = (
  requiredTools: readonly string[] = INSTANCE_DOCTOR_REQUIRED_TOOLS
) => `set -u
status=0
instance_root="\${HIVE_INSTANCE_ROOT:-${DEFAULT_INSTANCE_ROOT}}"

case "$instance_root" in
  "~") instance_root="$HOME" ;;
  "~/"*) instance_root="$HOME/\${instance_root#\\~/}" ;;
esac

printf 'Hive instance doctor\n'
printf 'instance_root=%s\n' "$instance_root"
printf 'platform=%s\n' "$(uname -s 2>/dev/null || printf unknown)"

for tool in ${requiredTools.map(quoteRemoteShellValue).join(" ")}; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'ok tool %s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'missing tool %s\n' "$tool"
    status=1
  fi
done

if [ -d "$instance_root" ]; then
  printf 'ok instance_root exists\n'
else
  printf 'missing instance_root %s\n' "$instance_root"
  status=1
fi

if [ -w "$instance_root" ]; then
  printf 'ok instance_root writable\n'
else
  printf 'missing instance_root_writable %s\n' "$instance_root"
  status=1
fi

exit "$status"
`;
