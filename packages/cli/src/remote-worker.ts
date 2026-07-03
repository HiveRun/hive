const DEFAULT_SSH_PORT = 22;
const DEFAULT_WORKSPACE_ROOT = "~/.hive/workspaces";
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const WHITESPACE_PATTERN = /\s/;
const LINE_BREAK_PATTERN = /[\r\n]/;

const REMOTE_DOCTOR_REQUIRED_TOOLS = ["git", "bun", "opencode"] as const;

export type RemoteDoctorOptions = {
  identityFile?: string | null;
  port?: string | null;
  target?: string | null;
  workspaceRoot?: string | null;
};

type RemoteDoctorConfig = {
  identityFile?: string;
  port: number;
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
  const portResult = portValue
    ? parsePort(portValue, "SSH port")
    : { ok: true as const, port: DEFAULT_SSH_PORT };
  if (!portResult.ok) {
    return portResult;
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

  const identityFile = normalizeRequiredValue(options.identityFile);
  if (identityFile) {
    const identityFileError = validateNoLineBreaks(
      identityFile,
      "Identity file"
    );
    if (identityFileError) {
      return { ok: false, message: identityFileError };
    }
  }

  return {
    ok: true,
    config: {
      ...(identityFile ? { identityFile } : {}),
      port: portResult.port,
      target,
      workspaceRoot,
    },
  };
};

export const buildRemoteDoctorSshArgs = (config: RemoteDoctorConfig) => {
  const args = [
    "-T",
    "-o",
    "BatchMode=no",
    "-o",
    "ConnectTimeout=10",
    "-p",
    String(config.port),
  ];

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
  "~/"*) workspace_root="$HOME/\${workspace_root#~/}" ;;
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
