/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import {
  buildInstanceDoctorScript,
  buildInstanceDoctorSshArgs,
  quoteRemoteShellValue,
  resolveInstanceDoctorConfig,
} from "./instance-doctor";

describe("resolveInstanceDoctorConfig", () => {
  it("resolves a basic OpenSSH target with defaults", () => {
    expect(resolveInstanceDoctorConfig({ target: "gpu-box" })).toEqual({
      ok: true,
      config: {
        instanceRoot: "~/.hive",
        target: "gpu-box",
      },
    });
  });

  it("trims optional SSH fields", () => {
    expect(
      resolveInstanceDoctorConfig({
        identityFile: " ~/.ssh/id_ed25519 ",
        instanceRoot: " ~/.hive-company ",
        knownHostsFile: " ~/.ssh/known_hosts ",
        port: " 2222 ",
        target: " user@example.com ",
      })
    ).toEqual({
      ok: true,
      config: {
        identityFile: "~/.ssh/id_ed25519",
        instanceRoot: "~/.hive-company",
        knownHostsFile: "~/.ssh/known_hosts",
        port: 2222,
        target: "user@example.com",
      },
    });
  });

  it("rejects missing targets", () => {
    expect(resolveInstanceDoctorConfig({ target: " " })).toEqual({
      ok: false,
      message: "Pass an SSH target to inspect.",
    });
  });

  it("rejects target values that could become SSH options", () => {
    expect(
      resolveInstanceDoctorConfig({ target: "-oProxyCommand=bad" })
    ).toEqual({
      ok: false,
      message:
        "SSH target must be an OpenSSH host alias or user@host without whitespace.",
    });
  });

  it("rejects invalid SSH ports", () => {
    expect(
      resolveInstanceDoctorConfig({ port: "70000", target: "gpu-box" })
    ).toEqual({
      ok: false,
      message: "SSH port must be an integer between 1 and 65535.",
    });
  });

  it("rejects line breaks in instance paths", () => {
    expect(
      resolveInstanceDoctorConfig({
        instanceRoot: "~/.hive\ncompany",
        target: "gpu-box",
      })
    ).toEqual({
      ok: false,
      message: "Instance root must not contain line breaks.",
    });
  });

  it("rejects line breaks in known hosts paths", () => {
    expect(
      resolveInstanceDoctorConfig({
        knownHostsFile: "~/.ssh/known\nhosts",
        target: "gpu-box",
      })
    ).toEqual({
      ok: false,
      message: "Known hosts file must not contain line breaks.",
    });
  });
});

describe("quoteRemoteShellValue", () => {
  it("quotes single quotes for remote shell assignment", () => {
    expect(quoteRemoteShellValue("~/Hive's Instance")).toBe(
      "'~/Hive'\\''s Instance'"
    );
  });
});

describe("buildInstanceDoctorSshArgs", () => {
  it("does not override OpenSSH config alias ports by default", () => {
    expect(
      buildInstanceDoctorSshArgs({
        instanceRoot: "~/.hive",
        target: "gpu-box",
      })
    ).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "gpu-box",
      "HIVE_INSTANCE_ROOT='~/.hive' sh -s",
    ]);
  });

  it("builds a conservative SSH command", () => {
    expect(
      buildInstanceDoctorSshArgs({
        identityFile: "~/.ssh/id_ed25519",
        instanceRoot: "~/Hive's Instance",
        knownHostsFile: "~/.ssh/known_hosts",
        port: 2222,
        target: "gpu-box",
      })
    ).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "UserKnownHostsFile=~/.ssh/known_hosts",
      "-o",
      "IdentitiesOnly=yes",
      "-p",
      "2222",
      "-i",
      "~/.ssh/id_ed25519",
      "gpu-box",
      "HIVE_INSTANCE_ROOT='~/Hive'\\''s Instance' sh -s",
    ]);
  });
});

describe("buildInstanceDoctorScript", () => {
  it("checks required tools and instance root readiness", () => {
    const script = buildInstanceDoctorScript();

    expect(script).toContain("Hive instance doctor");
    expect(script).toContain("for tool in 'git' 'bun' 'opencode'; do");
    expect(script).toContain('command -v "$tool"');
    expect(script).toContain("ok instance_root exists");
    const tildeExpansionSnippet = [
      'instance_root="$HOME/',
      "$",
      '{instance_root#\\~/}"',
    ].join("");
    expect(script).toContain(tildeExpansionSnippet);
  });
});
