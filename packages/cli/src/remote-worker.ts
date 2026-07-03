const DEFAULT_WORKSPACE_ROOT = "~/.hive/workspaces";
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const WHITESPACE_PATTERN = /\s/;
const LINE_BREAK_PATTERN = /[\r\n]/;

const REMOTE_DOCTOR_REQUIRED_TOOLS = ["git", "bun", "opencode"] as const;

export type RemoteDoctorOptions = {
  identityFile?: string | null;
  knownHostsFile?: string | null;
  port?: string | null;
  target?: string | null;
  workspaceRoot?: string | null;
};

type RemoteDoctorConfig = {
  identityFile?: string;
  knownHostsFile?: string;
  port?: number;
  target: string;
  workspaceRoot: string;
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

type ResolveRemoteDoctorConfigResult =
  | {
      ok: true;
      config: RemoteDoctorConfig;
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

export const resolveRemoteDoctorConfig = (
  options: RemoteDoctorOptions
): ResolveRemoteDoctorConfigResult => {
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

  const workspaceRoot =
    normalizeRequiredValue(options.workspaceRoot) ?? DEFAULT_WORKSPACE_ROOT;
  const workspaceRootError = validateNoLineBreaks(
    workspaceRoot,
    "Workspace root"
  );
  if (workspaceRootError) {
    return { ok: false, message: workspaceRootError };
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
      ...(port ? { port } : {}),
      target,
      workspaceRoot,
    },
  };
};

export const buildRemoteDoctorSshArgs = (config: RemoteDoctorConfig) => {
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
    `HIVE_REMOTE_WORKSPACE_ROOT=${quoteRemoteShellValue(
      config.workspaceRoot
    )} sh -s`
  );

  return args;
};

export const buildRemoteDoctorScript = (
  requiredTools: readonly string[] = REMOTE_DOCTOR_REQUIRED_TOOLS
) => `set -u
status=0
workspace_root="\${HIVE_REMOTE_WORKSPACE_ROOT:-${DEFAULT_WORKSPACE_ROOT}}"

case "$workspace_root" in
  "~") workspace_root="$HOME" ;;
  "~/"*) workspace_root="$HOME/\${workspace_root#\\~/}" ;;
esac

printf 'Hive remote doctor\n'
printf 'workspace_root=%s\n' "$workspace_root"
printf 'platform=%s\n' "$(uname -s 2>/dev/null || printf unknown)"

for tool in ${requiredTools.map(quoteRemoteShellValue).join(" ")}; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'ok tool %s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'missing tool %s\n' "$tool"
    status=1
  fi
done

if [ -d "$workspace_root" ]; then
  printf 'ok workspace_root exists\n'
else
  printf 'missing workspace_root %s\n' "$workspace_root"
  status=1
fi

if [ -w "$workspace_root" ]; then
  printf 'ok workspace_root writable\n'
else
  printf 'missing workspace_root_writable %s\n' "$workspace_root"
  status=1
fi

exit "$status"
`;
