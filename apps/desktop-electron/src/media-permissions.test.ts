import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  installMediaPermissionHandlers,
  isTrustedRendererPermissionAllowed,
  isWithinTrustedRendererScope,
  resolveTrustedRendererScope,
} from "./media-permissions";

type PermissionCheckHandler = Parameters<
  Session["setPermissionCheckHandler"]
>[0];
type PermissionRequestHandler = Parameters<
  Session["setPermissionRequestHandler"]
>[0];

const requireInstalledHandler = <Handler>(
  handler: Handler | undefined,
  name: string
): Handler => {
  if (!handler) {
    throw new Error(`${name} was not installed`);
  }
  return handler;
};

const createPermissionHarness = (options: {
  rendererUrl: string;
  rendererType: "trusted" | "viewer";
  requestMicrophoneAccess?: (origin: string) => Promise<boolean>;
}) => {
  const setPermissionCheckHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const session = {
    setDisplayMediaRequestHandler: vi.fn(),
    setPermissionCheckHandler,
    setPermissionRequestHandler,
  } as unknown as Session;
  const contents = {
    getURL: () => options.rendererUrl,
    once: () => contents,
  } as unknown as WebContents;
  const controller = installMediaPermissionHandlers(session, {
    requestMicrophoneAccess: options.requestMicrophoneAccess,
  });
  if (options.rendererType === "viewer") {
    controller.registerViewer(contents, options.rendererUrl);
  } else {
    controller.registerTrustedRenderer(contents, options.rendererUrl);
    controller.activateTrustedRenderer(contents, options.rendererUrl);
  }
  return {
    checkHandler: requireInstalledHandler(
      setPermissionCheckHandler.mock.calls[0]?.[0] as
        | PermissionCheckHandler
        | undefined,
      "Permission check handler"
    ),
    contents,
    controller,
    requestHandler: requireInstalledHandler(
      setPermissionRequestHandler.mock.calls[0]?.[0] as
        | PermissionRequestHandler
        | undefined,
      "Permission request handler"
    ),
  };
};

const createViewerPermissionHarness = (options: {
  viewerUrl: string;
  requestViewerMicrophoneAccess?: (origin: string) => Promise<boolean>;
}) =>
  createPermissionHarness({
    rendererType: "viewer",
    rendererUrl: options.viewerUrl,
    requestMicrophoneAccess: options.requestViewerMicrophoneAccess,
  });

const createTrustedRendererPermissionHarness = (
  rendererUrl: string,
  requestMicrophoneAccess?: (origin: string) => Promise<boolean>
) =>
  createPermissionHarness({
    rendererType: "trusted",
    rendererUrl,
    requestMicrophoneAccess,
  });

const requestAudioPermission = (options: {
  callback: (granted: boolean) => void;
  contents: WebContents;
  handler: PermissionRequestHandler;
  requestingUrl: string;
  securityOrigin: string;
}) =>
  options.handler(options.contents, "media", options.callback, {
    isMainFrame: true,
    mediaTypes: ["audio"],
    requestingUrl: options.requestingUrl,
    securityOrigin: options.securityOrigin,
  });

const requestAudioPermissionAndFlush = async (
  options: Parameters<typeof requestAudioPermission>[0]
) => {
  requestAudioPermission(options);
  await Promise.resolve();
  await Promise.resolve();
};

const checkAudioPermission = (
  handler: PermissionCheckHandler,
  contents: WebContents,
  requestingUrl: string,
  securityOrigin: string
) =>
  handler(contents, "media", securityOrigin, {
    isMainFrame: true,
    mediaType: "audio",
    requestingUrl,
    securityOrigin,
  });

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

describe("trusted renderer media permissions", () => {
  it("requires approval before allowing audio from the active trusted document", async () => {
    const rendererUrl = "file:///opt/hive/public/index.html";
    const requestMicrophoneAccess = vi.fn().mockResolvedValue(true);
    const { checkHandler, contents, requestHandler } =
      createTrustedRendererPermissionHarness(
        rendererUrl,
        requestMicrophoneAccess
      );

    expect(
      checkAudioPermission(checkHandler, contents, rendererUrl, "file://")
    ).toBe(false);
    const callback = vi.fn();
    await requestAudioPermissionAndFlush({
      callback,
      contents,
      handler: requestHandler,
      requestingUrl: rendererUrl,
      securityOrigin: "file://",
    });
    expect(callback).toHaveBeenCalledWith(true);
    expect(requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(requestMicrophoneAccess).toHaveBeenCalledWith("file://");
    expect(
      checkAudioPermission(checkHandler, contents, rendererUrl, "file://")
    ).toBe(true);
    expect(
      checkAudioPermission(
        checkHandler,
        contents,
        "file:///opt/hive/public/index.html/cells/1",
        "file://"
      )
    ).toBe(true);
  });

  it("rejects non-audio media but keeps trust through SPA navigation", () => {
    const rendererUrl = "file:///opt/hive/public/index.html";
    const { checkHandler, contents } =
      createTrustedRendererPermissionHarness(rendererUrl);

    expect(
      checkHandler(contents, "media", "file://", {
        isMainFrame: true,
        mediaType: "video",
        requestingUrl: rendererUrl,
        securityOrigin: "file://",
      })
    ).toBe(false);
    expect(
      checkHandler(contents, "media", "file://", {
        isMainFrame: true,
        mediaType: "audio",
        requestingUrl: "file:///opt/hive/public/other.html",
        securityOrigin: "file://",
      })
    ).toBe(false);
  });

  it("keeps trusted renderer audio denied when approval is refused", async () => {
    const rendererUrl = "file:///opt/hive/public/index.html";
    const requestMicrophoneAccess = vi.fn().mockResolvedValue(false);
    const { contents, requestHandler } = createTrustedRendererPermissionHarness(
      rendererUrl,
      requestMicrophoneAccess
    );
    const callback = vi.fn();

    await requestAudioPermissionAndFlush({
      callback,
      contents,
      handler: requestHandler,
      requestingUrl: rendererUrl,
      securityOrigin: "file://",
    });

    expect(callback).toHaveBeenCalledWith(false);
    expect(requestMicrophoneAccess).toHaveBeenCalledOnce();
  });
});

describe("viewer media permissions", () => {
  it("rejects an empty media security origin", () => {
    const viewerUrl = "http://127.0.0.1:4173/";
    const { checkHandler, contents } = createViewerPermissionHarness({
      viewerUrl,
    });

    expect(
      checkHandler(contents, "media", viewerUrl, {
        isMainFrame: true,
        mediaType: "audio",
        requestingUrl: viewerUrl,
        securityOrigin: "",
      })
    ).toBe(false);
  });

  it("requires approval before granting viewer microphone access", async () => {
    const requestViewerMicrophoneAccess = vi.fn().mockResolvedValue(true);
    const viewerUrl = "http://127.0.0.1:4173/";
    const { checkHandler, contents, requestHandler } =
      createViewerPermissionHarness({
        viewerUrl,
        requestViewerMicrophoneAccess,
      });
    const checkDetails = {
      isMainFrame: true,
      mediaType: "audio" as const,
      requestingUrl: viewerUrl,
      securityOrigin: new URL(viewerUrl).origin,
    };
    expect(
      checkHandler(contents, "media", new URL(viewerUrl).origin, checkDetails)
    ).toBe(false);

    const firstCallback = vi.fn();

    requestAudioPermission({
      callback: firstCallback,
      contents,
      handler: requestHandler,
      requestingUrl: viewerUrl,
      securityOrigin: new URL(viewerUrl).origin,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstCallback).toHaveBeenCalledWith(true);
    expect(requestViewerMicrophoneAccess).toHaveBeenCalledOnce();
    expect(requestViewerMicrophoneAccess).toHaveBeenCalledWith(
      new URL(viewerUrl).origin
    );
    expect(
      checkHandler(contents, "media", new URL(viewerUrl).origin, checkDetails)
    ).toBe(true);

    const secondCallback = vi.fn();
    requestAudioPermission({
      callback: secondCallback,
      contents,
      handler: requestHandler,
      requestingUrl: viewerUrl,
      securityOrigin: new URL(viewerUrl).origin,
    });
    expect(secondCallback).toHaveBeenCalledWith(true);
    expect(requestViewerMicrophoneAccess).toHaveBeenCalledOnce();
  });

  it("denies stale approval after the viewer is re-registered", async () => {
    let resolveAccess: ((approved: boolean) => void) | undefined;
    const viewerUrl = "http://localhost:4173/";
    const { contents, controller, requestHandler } =
      createViewerPermissionHarness({
        viewerUrl,
        requestViewerMicrophoneAccess: () =>
          new Promise<boolean>((resolve) => {
            resolveAccess = resolve;
          }),
      });
    const callback = vi.fn();
    requestAudioPermission({
      callback,
      contents,
      handler: requestHandler,
      requestingUrl: viewerUrl,
      securityOrigin: new URL(viewerUrl).origin,
    });

    controller.unregisterViewer(contents);
    controller.registerViewer(contents, viewerUrl);
    resolveAccess?.(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(false);
  });
});
