import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  installMediaPermissionHandlers,
  isTrustedRendererPermissionAllowed,
  isWithinTrustedRendererScope,
  resolveTrustedRendererScope,
} from "./media-permissions";

describe("trusted renderer scope", () => {
  it("binds file renderers to one normalized document", () => {
    const scope = resolveTrustedRendererScope(
      "file:///opt/hive/public/../public/index.html?theme=dark#viewer"
    );

    expect(scope).toEqual({
      kind: "document",
      value: "file:///opt/hive/public/index.html",
    });
    expect(
      scope &&
        isWithinTrustedRendererScope(
          scope,
          "file:///opt/hive/public/index.html?theme=light#chat"
        )
    ).toBe(true);
    expect(
      scope &&
        isWithinTrustedRendererScope(
          scope,
          "file:///opt/hive/public/other.html"
        )
    ).toBe(false);
  });

  it("scopes HTTP renderers to their exact origin", () => {
    const scope = resolveTrustedRendererScope("http://127.0.0.1:4173/app");

    expect(scope).toEqual({
      kind: "origin",
      value: "http://127.0.0.1:4173",
    });
    expect(
      scope &&
        isWithinTrustedRendererScope(scope, "http://127.0.0.1:4173/cells/1")
    ).toBe(true);
    expect(
      scope &&
        isWithinTrustedRendererScope(scope, "http://127.0.0.1:4174/cells/1")
    ).toBe(false);
  });

  it("keeps packaged trust through pushState and revokes unexpected commits", () => {
    const session = {
      setDisplayMediaRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    } as unknown as Session;
    let currentUrl = "file:///opt/hive/public/index.html";
    const contents = {
      getURL: () => currentUrl,
      id: 1,
      once: () => contents,
    } as unknown as WebContents;
    const controller = installMediaPermissionHandlers(session);

    controller.registerTrustedRenderer(contents, currentUrl);
    expect(controller.isTrustedRenderer(contents)).toBe(false);
    expect(
      controller.isTrustedRendererUrl(contents, `${currentUrl}?boot=1`)
    ).toBe(true);
    expect(controller.activateTrustedRenderer(contents, currentUrl)).toBe(true);

    currentUrl = "file:///opt/hive/public/index.html/cells/1";
    expect(controller.isTrustedRenderer(contents)).toBe(true);

    expect(
      controller.activateTrustedRenderer(
        contents,
        "file:///opt/hive/public/other.html"
      )
    ).toBe(false);
    expect(controller.isTrustedRenderer(contents)).toBe(false);
  });

  it.each([
    "data:text/html,hello",
    "blob:https://localhost/6dbaf6d4-21a5-40df-95b3-ec02d578afd7",
    "about:blank",
    "javascript:void(0)",
  ])("rejects opaque or executable renderer URL %s", (url) => {
    expect(resolveTrustedRendererScope(url)).toBeNull();
  });
});

describe("trusted renderer non-media permissions", () => {
  it.each(["clipboard-sanitized-write", "fullscreen"])(
    "allows %s only for a trusted main frame",
    (permission) => {
      expect(
        isTrustedRendererPermissionAllowed({
          isMainFrame: true,
          isTrustedRenderer: true,
          permission,
        })
      ).toBe(true);
      expect(
        isTrustedRendererPermissionAllowed({
          isMainFrame: true,
          isTrustedRenderer: false,
          permission,
        })
      ).toBe(false);
      expect(
        isTrustedRendererPermissionAllowed({
          isMainFrame: false,
          isTrustedRenderer: true,
          permission,
        })
      ).toBe(false);
    }
  );
});

describe("viewer media permissions", () => {
  it("rejects an empty media security origin", () => {
    const setPermissionCheckHandler = vi.fn();
    const session = {
      setDisplayMediaRequestHandler: vi.fn(),
      setPermissionCheckHandler,
      setPermissionRequestHandler: vi.fn(),
    } as unknown as Session;
    const viewerUrl = "http://127.0.0.1:4173/";
    const contents = {
      getURL: () => viewerUrl,
      once: () => contents,
    } as unknown as WebContents;
    const controller = installMediaPermissionHandlers(session);
    controller.registerViewer(contents, viewerUrl);

    type PermissionCheckHandler = Parameters<
      Session["setPermissionCheckHandler"]
    >[0];
    const handler = setPermissionCheckHandler.mock.calls[0]?.[0] as
      | PermissionCheckHandler
      | undefined;
    if (!handler) {
      throw new Error("Permission check handler was not installed");
    }

    expect(
      handler(contents, "media", viewerUrl, {
        isMainFrame: true,
        mediaType: "audio",
        requestingUrl: viewerUrl,
        securityOrigin: "",
      })
    ).toBe(false);
  });
});
