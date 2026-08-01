import type {
  MediaAccessPermissionRequest,
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
  try {
    return value ? new URL(value) : null;
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
  return Boolean(
    url &&
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
  return candidate?.kind === scope.kind && candidate.value === scope.value;
};

export const installMediaPermissionHandlers = (
  session: Session,
  options: {
    requestViewerMicrophoneAccess?: (origin: string) => Promise<boolean>;
  } = {}
) => {
  const trustedRenderers = new WeakMap<
    WebContents,
    TrustedRendererRegistration
  >();
  const viewerOrigins = new WeakMap<WebContents, string>();
  const viewerRegistrations = new WeakMap<WebContents, object>();
  const approvedMicrophoneViewers = new WeakSet<WebContents>();
  const pendingMicrophoneRequests = new WeakMap<
    WebContents,
    Promise<boolean>
  >();
  const hasOrigin = (url: string | undefined, origin: string) =>
    isAllowedLoopbackUrl(url) && resolveOrigin(url) === origin;

  const isAllowedViewerRequest = (
    contents: WebContents | null,
    ...requestUrls: (string | undefined)[]
  ) => {
    if (!contents) {
      return false;
    }

    const registeredOrigin = viewerOrigins.get(contents);
    return Boolean(
      registeredOrigin &&
        hasOrigin(contents.getURL(), registeredOrigin) &&
        requestUrls.every(
          (url) => url === undefined || hasOrigin(url, registeredOrigin)
        )
    );
  };

  const isTrustedRenderer = (contents: WebContents | null) =>
    Boolean(contents && trustedRenderers.get(contents)?.active);

  const isAllowedTrustedPermission = (
    contents: WebContents | null,
    permission: string,
    isMainFrame: boolean
  ) =>
    isTrustedRendererPermissionAllowed({
      isMainFrame,
      isTrustedRenderer: isTrustedRenderer(contents),
      permission,
    });

  session.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) => {
      if (permission === "media") {
        return (
          Boolean(requestingOrigin) &&
          details.mediaType === "audio" &&
          Boolean(contents && approvedMicrophoneViewers.has(contents)) &&
          isAllowedViewerRequest(
            contents,
            requestingOrigin,
            details.requestingUrl,
            details.securityOrigin ?? requestingOrigin
          )
        );
      }

      return isAllowedTrustedPermission(
        contents,
        permission,
        details.isMainFrame
      );
    }
  );

  session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (permission !== "media") {
        const requestDetails = details as PermissionRequest;
        callback(
          isAllowedTrustedPermission(
            contents,
            permission,
            requestDetails.isMainFrame
          )
        );
        return;
      }

      const mediaDetails = details as MediaAccessPermissionRequest;
      const mediaTypes = mediaDetails.mediaTypes ?? [];
      const securityOrigin =
        mediaDetails.securityOrigin ?? mediaDetails.requestingUrl;
      const isAllowedAudioRequest =
        Boolean(securityOrigin) &&
        mediaTypes.length > 0 &&
        mediaTypes.every((mediaType) => mediaType === "audio") &&
        isAllowedViewerRequest(
          contents,
          mediaDetails.requestingUrl,
          securityOrigin
        );
      if (!(isAllowedAudioRequest && securityOrigin)) {
        callback(false);
        return;
      }

      if (approvedMicrophoneViewers.has(contents)) {
        callback(true);
        return;
      }

      const registration = viewerRegistrations.get(contents);
      if (!registration) {
        callback(false);
        return;
      }
      let request = pendingMicrophoneRequests.get(contents);
      if (!request) {
        request = Promise.resolve(
          options.requestViewerMicrophoneAccess?.(securityOrigin) ?? false
        ).catch(() => false);
        pendingMicrophoneRequests.set(contents, request);
      }

      request.then((approved) => {
        if (pendingMicrophoneRequests.get(contents) === request) {
          pendingMicrophoneRequests.delete(contents);
        }
        const stillAllowed =
          viewerRegistrations.get(contents) === registration &&
          isAllowedViewerRequest(
            contents,
            mediaDetails.requestingUrl,
            securityOrigin
          );
        if (approved && stillAllowed) {
          approvedMicrophoneViewers.add(contents);
        }
        callback(approved && stillAllowed);
      });
    }
  );

  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));

  return {
    activateTrustedRenderer: (contents: WebContents, url: string) => {
      const registration = trustedRenderers.get(contents);
      if (
        !(registration && isWithinTrustedRendererScope(registration.scope, url))
      ) {
        trustedRenderers.delete(contents);
        return false;
      }
      registration.active = true;
      return true;
    },
    isTrustedRenderer,
    isTrustedRendererUrl: (contents: WebContents, url: string) => {
      const registration = trustedRenderers.get(contents);
      return Boolean(
        registration && isWithinTrustedRendererScope(registration.scope, url)
      );
    },
    registerTrustedRenderer: (contents: WebContents, expectedUrl: string) => {
      const scope = resolveTrustedRendererScope(expectedUrl);
      if (!scope) {
        throw new Error("Trusted renderer URL must be file, HTTP, or HTTPS");
      }
      trustedRenderers.set(contents, { active: false, scope });
      contents.once("destroyed", () => trustedRenderers.delete(contents));
    },
    registerViewer: (contents: WebContents, rootUrl: string) => {
      viewerOrigins.delete(contents);
      viewerRegistrations.delete(contents);
      approvedMicrophoneViewers.delete(contents);
      pendingMicrophoneRequests.delete(contents);
      const origin = resolveOrigin(rootUrl);
      if (!(origin && isAllowedLoopbackUrl(rootUrl))) {
        return;
      }
      viewerOrigins.set(contents, origin);
      viewerRegistrations.set(contents, {});
      contents.once("destroyed", () => {
        viewerOrigins.delete(contents);
        viewerRegistrations.delete(contents);
        approvedMicrophoneViewers.delete(contents);
        pendingMicrophoneRequests.delete(contents);
      });
    },
    unregisterViewer: (contents: WebContents) => {
      viewerOrigins.delete(contents);
      viewerRegistrations.delete(contents);
      approvedMicrophoneViewers.delete(contents);
      pendingMicrophoneRequests.delete(contents);
    },
  };
};

export type MediaPermissionController = ReturnType<
  typeof installMediaPermissionHandlers
>;
