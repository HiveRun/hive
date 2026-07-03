/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import {
  buildRemoteDoctorScript,
  buildRemoteDoctorSshArgs,
  quoteRemoteShellValue,
  resolveRemoteDoctorConfig,
} from "./remote-worker";

describe("resolveRemoteDoctorConfig", () => {
  it("resolves a basic OpenSSH target with defaults", () => {
    expect(resolveRemoteDoctorConfig({ target: "gpu-box" })).toEqual({
      ok: true,
      config: {
        target: "gpu-box",
        workspaceRoot: "~/.hive/workspaces",
      },
    });
  });

  it("trims optional SSH fields", () => {
    expect(
      resolveRemoteDoctorConfig({
        identityFile: " ~/.ssh/id_ed25519 ",
        knownHostsFile: " ~/.ssh/known_hosts ",
        port: " 2222 ",
        target: " user@example.com ",
        workspaceRoot: " ~/hive-workspaces ",
      })
    ).toEqual({
      ok: true,
      config: {
        identityFile: "~/.ssh/id_ed25519",
        knownHostsFile: "~/.ssh/known_hosts",
        port: 2222,
        target: "user@example.com",
        workspaceRoot: "~/hive-workspaces",
      },
    });
  });

  it("rejects missing targets", () => {
    expect(resolveRemoteDoctorConfig({ target: " " })).toEqual({
      ok: false,
      message: "Pass an SSH target to inspect.",
    });
  });

  it("rejects target values that could become SSH options", () => {
    expect(resolveRemoteDoctorConfig({ target: "-oProxyCommand=bad" })).toEqual(
      {
        ok: false,
        message:
          "SSH target must be an OpenSSH host alias or user@host without whitespace.",
      }
    );
  });

  it("rejects invalid SSH ports", () => {
    expect(
      resolveRemoteDoctorConfig({ port: "70000", target: "gpu-box" })
    ).toEqual({
      ok: false,
      message: "SSH port must be an integer between 1 and 65535.",
    });
  });

  it("rejects line breaks in remote paths", () => {
    expect(
      resolveRemoteDoctorConfig({
        target: "gpu-box",
        workspaceRoot: "~/hive\nworkspaces",
      })
    ).toEqual({
      ok: false,
      message: "Workspace root must not contain line breaks.",
    });
  });

  it("rejects line breaks in known hosts paths", () => {
    expect(
      resolveRemoteDoctorConfig({
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
    expect(quoteRemoteShellValue("~/Hive's Workspaces")).toBe(
      "'~/Hive'\\''s Workspaces'"
    );
  });
});

describe("buildRemoteDoctorSshArgs", () => {
  it("does not override OpenSSH config alias ports by default", () => {
    expect(
      buildRemoteDoctorSshArgs({
        target: "gpu-box",
        workspaceRoot: "~/.hive/workspaces",
      })
    ).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "gpu-box",
      "HIVE_REMOTE_WORKSPACE_ROOT='~/.hive/workspaces' sh -s",
    ]);
  });

  it("builds a conservative SSH command", () => {
    expect(
      buildRemoteDoctorSshArgs({
        identityFile: "~/.ssh/id_ed25519",
        knownHostsFile: "~/.ssh/known_hosts",
        port: 2222,
        target: "gpu-box",
        workspaceRoot: "~/Hive's Workspaces",
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
      "HIVE_REMOTE_WORKSPACE_ROOT='~/Hive'\\''s Workspaces' sh -s",
    ]);
  });
});

describe("buildRemoteDoctorScript", () => {
  it("checks required tools and workspace root readiness", () => {
    const script = buildRemoteDoctorScript();

    expect(script).toContain("Hive remote doctor");
    expect(script).toContain("for tool in 'git' 'bun' 'opencode'; do");
    expect(script).toContain('command -v "$tool"');
    expect(script).toContain("ok workspace_root exists");
    const tildeExpansionSnippet = [
      'workspace_root="$HOME/',
      "$",
      '{workspace_root#\\~/}"',
    ].join("");
    expect(script).toContain(tildeExpansionSnippet);
  });
});
