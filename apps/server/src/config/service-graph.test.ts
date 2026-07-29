import { describe, expect, it } from "vitest";
import {
  collectServiceGraphIssues,
  DEFAULT_SERVICE_PORT_NAME,
  getServiceDependencyClosure,
  resolveNamedPortDefinitions,
  resolveServicePortProtocol,
  topologicallySortServiceNames,
} from "./service-graph";

const hasEnvironmentCollision = (
  services: Parameters<typeof collectServiceGraphIssues>[0],
  message: string
) =>
  collectServiceGraphIssues(services).some((issue) =>
    issue.message.includes(message)
  );

describe("service graph", () => {
  it("provides an implicit primary port for legacy services", () => {
    expect(resolveNamedPortDefinitions({})).toEqual([
      {
        name: DEFAULT_SERVICE_PORT_NAME,
        primary: true,
        protocol: "http",
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
    expect(() =>
      topologicallySortServiceNames({
        web: { dependsOn: ["api"] },
        api: { dependsOn: ["web"] },
      })
    ).toThrow("Service dependency cycle: web -> api -> web");
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
