/// <reference types="vitest" />
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const SSH_CONNECT_TIMEOUT_SECONDS = 2;
const SSH_READY_TIMEOUT_MS = 30_000;
const SSH_READY_POLL_MS = 250;
const PORT_PATTERN = /^\d+$/;
const DOCKERFILE = `FROM alpine:3.20
RUN apk add --no-cache openssh-server
RUN adduser -D -s /bin/sh hive && echo 'hive:hive' | chpasswd
RUN ssh-keygen -A
RUN mkdir -p /run/sshd /home/hive/.ssh /home/hive/.hive/workspaces \
  && chown -R hive:hive /home/hive/.ssh /home/hive/.hive \
  && chmod 700 /home/hive/.ssh
COPY authorized_keys /home/hive/.ssh/authorized_keys
RUN chown hive:hive /home/hive/.ssh/authorized_keys \
  && chmod 600 /home/hive/.ssh/authorized_keys
RUN for tool in git bun opencode; do \
  printf '%s\\n' '#!/bin/sh' 'exit 0' > "/usr/local/bin/$tool"; \
  chmod +x "/usr/local/bin/$tool"; \
  done
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
`;

type CommandResult = SpawnSyncReturns<string>;

const run = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): CommandResult =>
  spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
  });

const commandOutput = (result: CommandResult) =>
  `status=${result.status ?? "unknown"}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

const assertCommandSucceeded = (result: CommandResult, label: string) => {
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${commandOutput(result)}`);
  }
};

const docker = (args: string[]) => run("docker", args);

const removeDockerContainer = (name: string | null) => {
  if (!name) {
    return;
  }
  docker(["rm", "-f", name]);
};

const removeDockerImage = (tag: string | null) => {
  if (!tag) {
    return;
  }
  docker(["rmi", "-f", tag]);
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForSsh = async (params: {
  env: NodeJS.ProcessEnv;
  identityFile: string;
  knownHostsFile: string;
  port: string;
}) => {
  const startedAt = Date.now();
  let lastResult: CommandResult | null = null;

  while (Date.now() - startedAt < SSH_READY_TIMEOUT_MS) {
    lastResult = run(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        `UserKnownHostsFile=${params.knownHostsFile}`,
        "-o",
        "IdentitiesOnly=yes",
        "-p",
        params.port,
        "-i",
        params.identityFile,
        "hive@127.0.0.1",
        "true",
      ],
      { env: params.env }
    );

    if (lastResult.status === 0) {
      return;
    }

    await sleep(SSH_READY_POLL_MS);
  }

  throw new Error(
    `Timed out waiting for local SSH fixture\n${
      lastResult ? commandOutput(lastResult) : "ssh was not attempted"
    }`
  );
};

describe("instance doctor Docker SSH E2E", () => {
  let tempRoot: string | null = null;
  let containerName: string | null = null;
  let imageTag: string | null = null;

  afterEach(() => {
    removeDockerContainer(containerName);
    removeDockerImage(imageTag);
    if (tempRoot) {
      rmSync(tempRoot, { force: true, recursive: true });
    }
    tempRoot = null;
    containerName = null;
    imageTag = null;
  });

  it("checks a disposable local SSH target end to end", async () => {
    const dockerInfo = docker(["info", "--format", "{{.ServerVersion}}"]);
    assertCommandSucceeded(
      dockerInfo,
      "docker info (Docker must be running for this opt-in E2E test)"
    );

    tempRoot = mkdtempSync(join(tmpdir(), "hive-instance-doctor-e2e-"));
    const keyPath = join(tempRoot, "id_ed25519");
    const keygen = run("ssh-keygen", [
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      keyPath,
      "-q",
    ]);
    assertCommandSucceeded(keygen, "ssh-keygen");

    const contextDir = join(tempRoot, "docker-context");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "Dockerfile"), DOCKERFILE, "utf8");
    writeFileSync(
      join(contextDir, "authorized_keys"),
      readFileSync(`${keyPath}.pub`, "utf8"),
      "utf8"
    );

    const runId = `${process.pid}-${Date.now()}`;
    imageTag = `hive-instance-doctor-e2e:${runId}`;
    containerName = `hive-instance-doctor-e2e-${runId}`;

    assertCommandSucceeded(
      docker(["build", "-t", imageTag, contextDir]),
      "docker build"
    );
    assertCommandSucceeded(
      docker([
        "run",
        "--name",
        containerName,
        "-d",
        "-p",
        "127.0.0.1::22",
        imageTag,
      ]),
      "docker run"
    );

    const inspectPort = docker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "22/tcp") 0).HostPort}}',
      containerName,
    ]);
    assertCommandSucceeded(inspectPort, "docker inspect port");
    const sshPort = inspectPort.stdout.trim();
    expect(sshPort).toMatch(PORT_PATTERN);

    const homeDir = join(tempRoot, "home");
    mkdirSync(homeDir, { recursive: true });
    const knownHostsPath = join(tempRoot, "known_hosts");

    const e2eEnv = {
      ...process.env,
      DOTENV_CONFIG_SILENT: "true",
      HOME: homeDir,
      SSH_ASKPASS_REQUIRE: "never",
    };

    await waitForSsh({
      env: e2eEnv,
      identityFile: keyPath,
      knownHostsFile: knownHostsPath,
      port: sshPort,
    });

    const doctor = run(
      "bun",
      [
        "src/index.ts",
        "instance",
        "doctor",
        "hive@127.0.0.1",
        "--ssh-port",
        sshPort,
        "--ssh-identity",
        keyPath,
        "--ssh-known-hosts",
        knownHostsPath,
        "--instance-root",
        "~/.hive",
      ],
      { cwd: packageRoot, env: e2eEnv }
    );
    assertCommandSucceeded(doctor, "hive instance doctor");

    expect(doctor.stdout).toContain("Hive instance doctor");
    expect(doctor.stdout).toContain("ok tool git /usr/local/bin/git");
    expect(doctor.stdout).toContain("ok tool bun /usr/local/bin/bun");
    expect(doctor.stdout).toContain("ok tool opencode /usr/local/bin/opencode");
    expect(doctor.stdout).toContain("instance_root=/home/hive/.hive");
    expect(doctor.stdout).toContain("ok instance_root exists");
    expect(doctor.stdout).toContain("ok instance_root writable");
    expect(doctor.stdout).toContain(
      "Host is ready for Hive instance bootstrap."
    );
  });
});
