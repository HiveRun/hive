import { describe, expect, it } from "vitest";
import type { ProcessService } from "./schema";
import {
  collectServiceGraphIssues,
  DEFAULT_SERVICE_PORT_NAME,
  getServiceDependencyClosure,
  resolveNamedPortDefinitions,
  resolveServicePortProtocol,
  resolveServicePortViewer,
  topologicallySortServiceNames,
} from "./service-graph";

const hasEnvironmentCollision = (
  services: Parameters<typeof collectServiceGraphIssues>[0],
  message: string
) =>
  collectServiceGraphIssues(services).some((issue) =>
    issue.message.includes(message)
  );

const processService = (
  overrides: Partial<Omit<ProcessService, "type" | "run">> = {}
): ProcessService => ({ type: "process", run: "test", ...overrides });

const graphIssueMessages = (
  services: Parameters<typeof collectServiceGraphIssues>[0]
) => collectServiceGraphIssues(services).map((issue) => issue.message);

describe("service graph", () => {
  it("provides an implicit primary port for legacy services", () => {
    expect(resolveNamedPortDefinitions({})).toEqual([
      {
        name: DEFAULT_SERVICE_PORT_NAME,
        primary: true,
        protocol: "http",
        viewer: true,
      },
    ]);
    expect(resolveServicePortProtocol({}, "default", "https")).toBe("https");
  });

  it("uses configured named protocols independently of the legacy default", () => {
    const definition = {
      ports: {
        http: { primary: true },
        metrics: { protocol: "tcp" as const },
        secure: { protocol: "https" as const },
      },
    };

    expect(resolveServicePortProtocol(definition, "http", "https")).toBe(
      "http"
    );
    expect(resolveServicePortProtocol(definition, "metrics", "https")).toBe(
      "tcp"
    );
    expect(resolveServicePortProtocol(definition, "secure", "http")).toBe(
      "https"
    );
    expect(resolveServicePortViewer(definition, "http")).toBe(true);
  });

  it("preserves exact host port requests", () => {
    expect(
      resolveNamedPortDefinitions({
        ports: {
          viewer: { port: 42_861, primary: true },
        },
      })
    ).toEqual([
      {
        name: "viewer",
        port: 42_861,
        primary: true,
        protocol: "http",
        viewer: true,
      },
    ]);
  });

  it("resolves explicit browser viewer eligibility", () => {
    const definition = {
      ports: {
        api: { primary: true, viewer: false },
        admin: { viewer: true },
      },
    };

    expect(resolveServicePortViewer(definition, "api")).toBe(false);
    expect(resolveServicePortViewer(definition, "admin")).toBe(true);
    expect(
      resolveServicePortViewer(
        { ports: { postgres: { primary: true, protocol: "tcp" } } },
        "postgres"
      )
    ).toBe(false);
  });

  it("sorts dependencies before dependents deterministically", () => {
    const services = {
      web: { dependsOn: ["api"] },
      worker: { dependsOn: ["db"] },
      api: { dependsOn: ["db"] },
      db: {},
    };

    expect(topologicallySortServiceNames(services)).toEqual([
      "db",
      "api",
      "web",
      "worker",
    ]);
    expect(getServiceDependencyClosure(services, "web")).toEqual([
      "db",
      "api",
      "web",
    ]);
  });

  it("reports dependency cycles with their path", () => {
    const services = {
      web: processService({ dependsOn: ["api"] }),
      api: processService({ dependsOn: ["web"] }),
    };
    const message = "Service dependency cycle: web -> api -> web";

    expect(() => topologicallySortServiceNames(services)).toThrow(message);
    expect(graphIssueMessages(services)).toContain(message);
  });

  it.each([
    [
      "empty named ports",
      { api: processService({ ports: {} }) },
      "ports must define at least one named port",
    ],
    [
      "missing primary named port",
      { api: processService({ ports: { http: {}, metrics: {} } }) },
      "ports must mark exactly one port as primary",
    ],
    [
      "multiple primary named ports",
      {
        api: processService({
          ports: { http: { primary: true }, metrics: { primary: true } },
        }),
      },
      "ports must mark exactly one port as primary",
    ],
    [
      "unknown dependencies",
      { api: processService({ dependsOn: ["db"] }) },
      'depends on unknown service "db"',
    ],
    [
      "self dependencies",
      { api: processService({ dependsOn: ["api"] }) },
      "cannot depend on itself",
    ],
    [
      "service environment prefixes",
      { "api-worker": processService(), api_worker: processService() },
      "produce the same environment prefix",
    ],
    [
      "port environment keys",
      {
        api: processService({
          ports: { "admin-http": { primary: true }, admin_http: {} },
        }),
      },
      "produce the same environment key",
    ],
    [
      "unknown readiness ports",
      {
        api: processService({
          ports: { http: { primary: true } },
          readiness: { checks: [{ type: "tcp", port: "metrics" }] },
        }),
      },
      'readiness references unknown port "metrics"',
    ],
    [
      "duplicate exact host ports",
      {
        api: processService({
          ports: { http: { port: 42_861, primary: true } },
        }),
        web: processService({
          ports: { http: { port: 42_861, primary: true } },
        }),
      },
      "Exact host port 42861 is requested by",
    ],
  ])("reports %s", (_name, services, message) => {
    expect(graphIssueMessages(services)).toEqual(
      expect.arrayContaining([expect.stringContaining(message)])
    );
  });

  it("detects collisions across primary and named port environment keys", () => {
    expect(
      hasEnvironmentCollision(
        {
          api: {
            type: "process",
            ports: { http: { primary: true } },
          },
          api_http: { type: "process" },
        },
        'Generated environment key "API_HTTP_PORT" collides'
      )
    ).toBe(true);
  });

  it("reserves fixed service port aliases", () => {
    expect(
      hasEnvironmentCollision(
        { service: { type: "process" } },
        'Generated environment key "SERVICE_PORT" collides between built-in alias "SERVICE_PORT" and service "service" primary port'
      )
    ).toBe(true);
  });
});
