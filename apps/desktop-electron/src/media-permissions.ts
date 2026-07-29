import type {
  MediaAccessPermissionRequest,
  PermissionCheckHandlerHandlerDetails,
  PermissionRequest,
  Session,
  WebContents,
} from "electron";

const ALLOWED_MEDIA_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TRUSTED_RENDERER_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
]);

const parseUrl = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isTrustedRendererPermissionAllowed = (options: {
  isMainFrame: boolean;
  isTrustedRenderer: boolean;
  permission: string;
}) =>
  options.isMainFrame &&
  options.isTrustedRenderer &&
  TRUSTED_RENDERER_PERMISSIONS.has(options.permission);

type TrustedRendererScope = {
  kind: "document" | "origin";
  value: string;
};

type TrustedRendererRegistration = {
  active: boolean;
  scope: TrustedRendererScope;
};

const isAllowedLoopbackUrl = (value: string | undefined) => {
  const url = parseUrl(value);
  if (!url) {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ALLOWED_MEDIA_HOSTNAMES.has(url.hostname) &&
    !url.username &&
    !url.password
  );
};

const resolveOrigin = (value: string | undefined) =>
  parseUrl(value)?.origin ?? null;

export const resolveTrustedRendererScope = (
  value: string | undefined
): TrustedRendererScope | null => {
  const url = parseUrl(value);
  if (!url) {
    return null;
  }

  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
  ) {
    return { kind: "origin", value: url.origin };
  }
  if (url.protocol !== "file:") {
    return null;
  }

  url.search = "";
  url.hash = "";
  return { kind: "document", value: url.href };
};

export const isWithinTrustedRendererScope = (
  scope: TrustedRendererScope,
  value: string | undefined
) => {
  const candidate = resolveTrustedRendererScope(value);
  return Boolean(
    candidate &&
      candidate.kind === scope.kind &&
      candidate.value === scope.value
  );
};

export const installMediaPermissionHandlers = (session: Session) => {
  const trustedRenderers = new Map<number, TrustedRendererRegistration>();
  const viewerOrigins = new Map<number, string>();

  const hasRegisteredOrigin = (
    registrations: Map<number, string>,
    contents: WebContents | null,
    requestingUrl?: string
  ) => {
    if (!contents) {
      return false;
    }

    const registeredOrigin = registrations.get(contents.id);
    return Boolean(
      registeredOrigin &&
        resolveOrigin(contents.getURL()) === registeredOrigin &&
        (!requestingUrl || resolveOrigin(requestingUrl) === registeredOrigin)
    );
  };

  const isAllowedViewerContents = (
    contents: WebContents | null,
    requestingUrl?: string
  ) =>
    hasRegisteredOrigin(viewerOrigins, contents, requestingUrl) &&
    isAllowedLoopbackUrl(contents?.getURL()) &&
    (!requestingUrl || isAllowedLoopbackUrl(requestingUrl));

  const isTrustedRenderer = (contents: WebContents | null) =>
    Boolean(contents && trustedRenderers.get(contents.id)?.active);

  const isAllowedCheck = (
    contents: WebContents | null,
    permission: string,
    requestingOrigin: string,
    details: PermissionCheckHandlerHandlerDetails
  ) =>
    permission === "media" &&
    details.mediaType === "audio" &&
    isAllowedViewerContents(contents, details.requestingUrl) &&
    isAllowedLoopbackUrl(requestingOrigin) &&
    isAllowedLoopbackUrl(details.securityOrigin ?? requestingOrigin) &&
    resolveOrigin(requestingOrigin) === viewerOrigins.get(contents?.id ?? -1);

  session.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) => {
      if (permission === "media") {
        return isAllowedCheck(contents, permission, requestingOrigin, details);
      }

      return isTrustedRendererPermissionAllowed({
        isMainFrame: details.isMainFrame,
        isTrustedRenderer: isTrustedRenderer(contents),
        permission,
      });
    }
  );

  session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (permission !== "media") {
        const requestDetails = details as PermissionRequest;
        callback(
          isTrustedRendererPermissionAllowed({
            isMainFrame: requestDetails.isMainFrame,
            isTrustedRenderer: isTrustedRenderer(contents),
            permission,
          })
        );
        return;
      }

      const mediaDetails = details as MediaAccessPermissionRequest;
      const mediaTypes = mediaDetails.mediaTypes ?? [];
      const registeredOrigin = viewerOrigins.get(contents.id);
      const securityOrigin =
        mediaDetails.securityOrigin ?? mediaDetails.requestingUrl;
      const requestAllowed =
        mediaTypes.length > 0 &&
        mediaTypes.every((mediaType) => mediaType === "audio") &&
        isAllowedViewerContents(contents, mediaDetails.requestingUrl) &&
        isAllowedLoopbackUrl(securityOrigin) &&
        resolveOrigin(securityOrigin) === registeredOrigin;

      callback(requestAllowed);
    }
  );

  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });

  return {
    activateTrustedRenderer: (contents: WebContents, url: string) => {
      const registration = trustedRenderers.get(contents.id);
      if (
        !(registration && isWithinTrustedRendererScope(registration.scope, url))
      ) {
        trustedRenderers.delete(contents.id);
        return false;
      }
      registration.active = true;
      return true;
    },
    isTrustedRenderer,
    isTrustedRendererUrl: (contents: WebContents, url: string) => {
      const registration = trustedRenderers.get(contents.id);
      return Boolean(
        registration && isWithinTrustedRendererScope(registration.scope, url)
      );
    },
    registerTrustedRenderer: (contents: WebContents, expectedUrl: string) => {
      const scope = resolveTrustedRendererScope(expectedUrl);
      if (!scope) {
        throw new Error("Trusted renderer URL must be file, HTTP, or HTTPS");
      }
      trustedRenderers.set(contents.id, { active: false, scope });
      contents.once("destroyed", () => {
        trustedRenderers.delete(contents.id);
      });
    },
    registerViewer: (contents: WebContents, rootUrl: string) => {
      viewerOrigins.delete(contents.id);
      const origin = resolveOrigin(rootUrl);
      if (!(origin && isAllowedLoopbackUrl(rootUrl))) {
        return;
      }
      viewerOrigins.set(contents.id, origin);
      contents.once("destroyed", () => {
        viewerOrigins.delete(contents.id);
      });
    },
    unregisterViewer: (contents: WebContents) => {
      viewerOrigins.delete(contents.id);
    },
    unregisterTrustedRenderer: (contents: WebContents) => {
      trustedRenderers.delete(contents.id);
    },
  };
};

export type MediaPermissionController = ReturnType<
  typeof installMediaPermissionHandlers
>;
