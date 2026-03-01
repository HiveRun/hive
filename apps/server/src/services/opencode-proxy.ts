const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const DEFAULT_OPENCODE_SERVER_USERNAME = "opencode";
const STATIC_FILE_EXTENSION_RE = /\.[a-z0-9]+$/i;
const ENCODED_WORKSPACE_SEGMENT_RE = /^[A-Za-z0-9_-]{16,}$/;
const UPPERCASE_RE = /[A-Z]/;
const SESSION_APP_ROUTE_SEGMENT_COUNT = 3;
const DIRECT_PROXY_SEGMENTS = new Set([
  "assets",
  "auth",
  "config",
  "project",
  "provider",
  "path",
  "find",
  "global",
  "experimental",
  "health",
  "event",
  "session",
  "agent",
  "command",
  "status",
  "mcp",
  "lsp",
  "permission",
  "question",
  "todo",
  "diff",
  "file",
  "current",
  "sprite",
  "favicon-v3.ico",
  "favicon-v3.svg",
  "favicon-96x96-v3.png",
  "apple-touch-icon-v3.png",
  "social-share.png",
  "site.webmanifest",
  "oc-theme-preload.js",
]);

function withTrailingSlash(input: string): string {
  return input.endsWith("/") ? input : `${input}/`;
}

function trimLeadingSlash(input: string): string {
  return input.startsWith("/") ? input.slice(1) : input;
}

function isLikelyOpencodeAppRoute(pathname: string): boolean {
  if (pathname === "/") {
    return false;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const firstSegment = segments[0] ?? "";
  if (DIRECT_PROXY_SEGMENTS.has(firstSegment)) {
    return false;
  }

  if (STATIC_FILE_EXTENSION_RE.test(firstSegment)) {
    return false;
  }

  const lastSegment = segments.at(-1) ?? "";
  if (STATIC_FILE_EXTENSION_RE.test(lastSegment)) {
    return false;
  }

  const looksLikeEncodedWorkspace =
    ENCODED_WORKSPACE_SEGMENT_RE.test(firstSegment) &&
    UPPERCASE_RE.test(firstSegment);

  if (!looksLikeEncodedWorkspace) {
    return false;
  }

  if (segments.length === 1) {
    return true;
  }

  const secondSegment = segments[1] ?? "";
  if (DIRECT_PROXY_SEGMENTS.has(secondSegment)) {
    return (
      secondSegment === "session" &&
      segments.length === SESSION_APP_ROUTE_SEGMENT_COUNT
    );
  }

  return true;
}

function stripWorkspacePrefixForApiPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return pathname;
  }

  const firstSegment = segments[0] ?? "";
  const secondSegment = segments[1] ?? "";
  const isWorkspacePrefix =
    ENCODED_WORKSPACE_SEGMENT_RE.test(firstSegment) &&
    UPPERCASE_RE.test(firstSegment);

  if (!isWorkspacePrefix) {
    return pathname;
  }

  if (!DIRECT_PROXY_SEGMENTS.has(secondSegment)) {
    return pathname;
  }

  if (
    secondSegment === "session" &&
    segments.length === SESSION_APP_ROUTE_SEGMENT_COUNT
  ) {
    return pathname;
  }

  return `/${segments.slice(1).join("/")}`;
}

export function buildOpencodeProxyTargetUrl(args: {
  requestUrl: string;
  cellId: string;
  upstreamBaseUrl: string;
}): URL {
  const { requestUrl, cellId, upstreamBaseUrl } = args;
  const incoming = new URL(requestUrl);
  const proxyPrefix = `/api/cells/${cellId}/opencode/proxy`;
  const hasPrefix = incoming.pathname.startsWith(proxyPrefix);
  const remainderPath = hasPrefix
    ? incoming.pathname.slice(proxyPrefix.length)
    : incoming.pathname;
  const normalizedRemainder = remainderPath.length > 0 ? remainderPath : "/";
  const normalizedForRouting =
    stripWorkspacePrefixForApiPath(normalizedRemainder);

  const upstreamRoot = withTrailingSlash(upstreamBaseUrl);

  if (isLikelyOpencodeAppRoute(normalizedForRouting)) {
    const appUrl = new URL(`/${incoming.search}`, upstreamRoot);
    for (const [key, value] of incoming.searchParams.entries()) {
      appUrl.searchParams.set(key, value);
    }
    if (!appUrl.searchParams.has("hive_app_path")) {
      appUrl.searchParams.set("hive_app_path", normalizedForRouting);
    }
    return appUrl;
  }

  const resolvedPath = trimLeadingSlash(normalizedForRouting);
  return new URL(`${resolvedPath}${incoming.search}`, upstreamRoot);
}

function buildAuthorizationHeader(): string | null {
  const password = process.env.HIVE_OPENCODE_SERVER_PASSWORD;
  if (!password) {
    return null;
  }

  const username =
    process.env.HIVE_OPENCODE_SERVER_USERNAME ??
    DEFAULT_OPENCODE_SERVER_USERNAME;
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

function buildForwardHeaders(args: {
  request: Request;
  opencodeDirectory?: string;
}): Headers {
  const { request, opencodeDirectory } = args;
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue;
    }
    if (
      lowerKey === "host" ||
      lowerKey === "accept-encoding" ||
      lowerKey === "content-length"
    ) {
      continue;
    }
    headers.set(key, value);
  }

  const authorization = buildAuthorizationHeader();
  if (authorization) {
    headers.set("authorization", authorization);
  }

  if (opencodeDirectory) {
    headers.set("x-opencode-directory", opencodeDirectory);
  }

  return headers;
}

function copyResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

function requestAllowsBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

type ProxyRequestBody = NonNullable<RequestInit["body"]>;

function isBodyInit(value: unknown): value is ProxyRequestBody {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  );
}

function resolveProxyRequestBody(args: {
  request: Request;
  fallbackBody?: unknown;
}): ProxyRequestBody | undefined {
  if (!requestAllowsBody(args.request.method)) {
    return;
  }

  if (!args.request.bodyUsed) {
    return args.request.body ?? undefined;
  }

  const fallbackBody = args.fallbackBody;
  if (fallbackBody === undefined || fallbackBody === null) {
    return;
  }

  if (isBodyInit(fallbackBody)) {
    return fallbackBody;
  }

  if (typeof fallbackBody === "object") {
    return JSON.stringify(fallbackBody);
  }

  return String(fallbackBody);
}

function rewriteHtmlForProxy(args: {
  html: string;
  proxyBasePath: string;
  targetUrl: URL;
}): string {
  const { html, proxyBasePath, targetUrl } = args;
  const prefix = proxyBasePath.endsWith("/")
    ? proxyBasePath.slice(0, -1)
    : proxyBasePath;

  let rewritten = html.replace(
    /(src|href|content)=("|')\/(?!\/)/g,
    `$1=$2${prefix}/`
  );

  if (!rewritten.includes("<base ")) {
    rewritten = rewritten.replace("<head>", `<head><base href="${prefix}/" />`);
  }

  const preloadParams = new URLSearchParams();
  preloadParams.set("hive_proxy", "2");
  for (const key of [
    "hive_app_path",
    "hive_color_scheme",
    "hive_theme_id",
    "hive_font",
  ]) {
    const value = targetUrl.searchParams.get(key);
    if (value) {
      preloadParams.set(key, value);
    }
  }

  rewritten = rewritten.replace(
    /oc-theme-preload\.js(?:\?[^"']*)?(["'])/g,
    `oc-theme-preload.js?${preloadParams.toString()}$1`
  );

  if (!rewritten.includes("hive-opencode-embed.css")) {
    const styleTag = `<link rel="stylesheet" href="${prefix}/hive-opencode-embed.css?hive_proxy=1" />`;
    rewritten = rewritten.replace("</head>", `${styleTag}</head>`);
  }

  return rewritten;
}

function shouldRewriteHtml(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("text/html");
}

function shouldRewriteManifest(args: {
  response: Response;
  targetUrl: URL;
}): boolean {
  const contentType =
    args.response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("application/manifest+json") ||
    args.targetUrl.pathname.endsWith("site.webmanifest")
  );
}

function rewriteManifestForProxy(args: {
  manifest: string;
  proxyBasePath: string;
}): string {
  const prefix = args.proxyBasePath.endsWith("/")
    ? args.proxyBasePath.slice(0, -1)
    : args.proxyBasePath;
  return args.manifest.replace(/"\/(?!\/)/g, `"${prefix}/`);
}

function shouldRewriteThemePreload(targetUrl: URL): boolean {
  return targetUrl.pathname.endsWith("oc-theme-preload.js");
}

function rewriteThemePreloadScript(args: {
  source: string;
  proxyBasePath: string;
}): string {
  const prefix = args.proxyBasePath.endsWith("/")
    ? args.proxyBasePath.slice(0, -1)
    : args.proxyBasePath;
  const bootstrap = `
try {
  const _hiveUrl = new URL(window.location.href)
  let _hiveScriptParams = new URLSearchParams()
  try {
    const _hiveCurrentScript = document.currentScript
    if (_hiveCurrentScript instanceof HTMLScriptElement && _hiveCurrentScript.src) {
      _hiveScriptParams = new URL(_hiveCurrentScript.src, window.location.origin).searchParams
    }
  } catch {}

  const _hiveGetParam = (key) => _hiveUrl.searchParams.get(key) ?? _hiveScriptParams.get(key)
  const _hiveProxyBase = window.location.origin + "${prefix}"
  const _hiveThemeId = _hiveGetParam("hive_theme_id")
  const _hiveScheme = _hiveGetParam("hive_color_scheme")
  const _hiveFont = _hiveGetParam("hive_font")

  if (_hiveThemeId) localStorage.setItem("opencode-theme-id", _hiveThemeId)
  if (_hiveScheme === "light" || _hiveScheme === "dark" || _hiveScheme === "system") {
    localStorage.setItem("opencode-color-scheme", _hiveScheme)
  }

  if (_hiveFont) {
    let _hiveSettings = {}
    try {
      const _hiveRaw = localStorage.getItem("settings.v3")
      if (_hiveRaw) _hiveSettings = JSON.parse(_hiveRaw)
    } catch {}

    _hiveSettings = typeof _hiveSettings === "object" && _hiveSettings !== null ? _hiveSettings : {}
    const _hiveAppearance =
      typeof _hiveSettings.appearance === "object" && _hiveSettings.appearance !== null
        ? _hiveSettings.appearance
        : {}
    _hiveSettings.appearance = { ..._hiveAppearance, font: _hiveFont }
    localStorage.setItem("settings.v3", JSON.stringify(_hiveSettings))
  }

  localStorage.setItem("opencode.settings.dat:defaultServerUrl", _hiveProxyBase)
  localStorage.removeItem("opencode.global.dat:server")

  const _hiveDesiredPath = _hiveGetParam("hive_app_path")
  if (_hiveDesiredPath && _hiveDesiredPath.startsWith("/") && window.location.pathname !== _hiveDesiredPath) {
    if (window.self === window.top) {
      const _hiveRefreshSafeUrl = _hiveUrl.pathname + _hiveUrl.search
      const _hiveRestoreLocation = () => {
        try {
          window.history.replaceState({}, "", _hiveRefreshSafeUrl)
        } catch {}
      }
      window.addEventListener("beforeunload", _hiveRestoreLocation)
      window.addEventListener("pagehide", _hiveRestoreLocation)
    }

    window.history.replaceState({}, "", _hiveDesiredPath)
  }

} catch {}
`;
  return `${bootstrap};\n${args.source}`;
}

function buildHiveEmbedCss(): string {
  return `:root {
  --font-family-sans: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --font-family-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

html,
body,
button,
input,
textarea,
select {
  font-family: var(--font-family-sans) !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
}

code,
pre,
kbd,
samp,
[class*="font-mono"] {
  font-family: var(--font-family-mono) !important;
}

* {
  border-radius: 0 !important;
  box-shadow: none !important;
}

html,
body {
  color-scheme: dark;
}

:root[data-color-scheme="light"] {
  --background-base: #f6f1e6;
  --background-weak: #efe6d7;
  --background-strong: #f2e8d6;
  --background-stronger: #f9f4ea;

  --surface-base: #f6ecdc;
  --surface-base-hover: #eee2cf;
  --surface-raised-base: #f2e6d3;
  --surface-raised-base-hover: #eadbc6;
  --surface-raised-strong: #e9dac4;
  --surface-raised-strong-hover: #e1cfb7;
  --surface-raised-stronger: #dcc8ad;
  --surface-raised-stronger-hover: #d4be9f;
  --surface-float-base: #f1e6d2;
  --surface-float-base-hover: #e8dac3;

  --text-base: #2b2520;
  --text-weak: #5b4d3c;
  --text-weaker: #7a6852;
  --text-strong: #1f1913;

  --border-base: #a08663;
  --border-hover: #8c734f;
  --border-weak-base: #b79d7a;
  --border-strong-base: #8a714e;

  --surface-interactive-base: #e8d6bb;
  --surface-interactive-hover: #e0caa8;
  --border-interactive-base: #a35d11;
  --text-interactive-base: #8e5a16;
  --icon-interactive-base: #8e5a16;
}

:root[data-color-scheme="dark"] {
  --background-base: #070504;
  --background-weak: #110d0c;
  --background-strong: #0b0807;
  --background-stronger: #050708;

  --surface-base: #120f0e;
  --surface-base-hover: #1a1513;
  --surface-base-active: #211a17;
  --surface-base-interactive-active: #2f241b;
  --base: #120f0e;
  --base2: #171311;
  --base3: #1f1815;
  --surface-inset-base: #0f0b0a;
  --surface-inset-base-hover: #17110f;
  --surface-inset-strong: #090706;
  --surface-inset-strong-hover: #100c0a;
  --surface-raised-base: #171311;
  --surface-raised-base-hover: #201915;
  --surface-raised-strong: #241d18;
  --surface-raised-strong-hover: #2d241d;
  --surface-raised-stronger: #352a22;
  --surface-raised-stronger-hover: #3e3128;
  --surface-weak: #1c1613;
  --surface-weaker: #241c17;
  --surface-strong: #2c231d;
  --surface-raised-stronger-non-alpha: #352a22;
  --surface-float-base: #120f0d;
  --surface-float-base-hover: #1a1512;

  --input-base: #171311;
  --input-hover: #211a16;
  --input-active: #251d18;
  --input-selected: #2f241b;
  --input-focus: #251d18;

  --text-base: #f4e6cd;
  --text-weak: #c9b99a;
  --text-weaker: #8a7a63;
  --text-strong: #ffe9a8;

  --border-base: #5a4630;
  --border-hover: #7a5c2a;
  --border-active: #8c6e2a;
  --border-selected: #f5a524;
  --border-weak-base: #4b3b28;
  --border-weak-hover: #5a4630;
  --border-weak-active: #7a5c2a;
  --border-weak-selected: #f5a524;
  --border-strong-base: #8c6e2a;
  --border-strong-hover: #a35d11;
  --border-strong-active: #c5771e;
  --border-strong-selected: #f5a524;
  --border-focus: #ffc857;
  --border-weaker-base: #3f3225;
  --border-weaker-hover: #5a4630;
  --border-weaker-active: #7a5c2a;
  --border-weaker-selected: #f5a524;
  --border-weaker-focus: #ffc857;
  --border-color: #7a5c2a;

  --surface-interactive-base: #2b2520;
  --surface-interactive-hover: #3b3127;
  --surface-interactive-weak: #1d1a17;
  --surface-interactive-weak-hover: #2a241e;
  --surface-brand-base: #f5a524;
  --surface-brand-hover: #ffc857;
  --border-interactive-base: #f5a524;
  --border-interactive-hover: #ffc857;
  --border-interactive-active: #ffc857;
  --border-interactive-selected: #ffc857;
  --border-interactive-focus: #ffc857;
  --text-interactive-base: #ffc857;
  --icon-interactive-base: #ffc857;

  --button-primary-base: #f5a524;
  --button-primary-hover: #ffc857;
  --button-secondary-base: #151b1f;
  --button-secondary-hover: #21282d;

  --text-on-brand-base: #050708;
  --text-on-brand-weak: #151515;
  --text-on-brand-strong: #000000;
  --text-on-interactive-base: #050708;
  --text-on-interactive-weak: #2b2520;
  --icon-brand-base: #f5a524;
  --icon-on-brand-base: #050708;
  --icon-on-brand-hover: #111416;
  --icon-on-brand-selected: #111416;
  --icon-on-interactive-base: #050708;

  --icon-base: #c9b99a;
  --icon-weak-base: #8a7a63;
  --icon-strong-base: #ffe9a8;
  --icon-info-base: #2dd4bf;
  --icon-info-hover: #8af8ee;
  --icon-info-active: #bdfef7;
  --icon-on-info-base: #2dd4bf;
  --icon-on-info-hover: #8af8ee;
  --icon-on-info-selected: #bdfef7;
  --icon-agent-plan-base: #ffc857;
  --icon-agent-ask-base: #2dd4bf;
  --icon-agent-build-base: #f5a524;

  --surface-success-base: #1f3a2a;
  --surface-success-weak: #13271d;
  --surface-success-strong: #2f7d4a;
  --surface-warning-base: #3b2a13;
  --surface-warning-weak: #2a1e0f;
  --surface-warning-strong: #a35d11;
  --surface-critical-base: #3b1e1b;
  --surface-critical-weak: #281514;
  --surface-critical-strong: #b93d3d;
  --surface-info-base: #18302e;
  --surface-info-weak: #122422;
  --surface-info-strong: #2b5a57;
  --surface-diff-unchanged-base: #111416;
  --surface-diff-skip-base: #151b1f;
  --surface-diff-hidden-base: #2b2520;
  --surface-diff-hidden-weak: #231f1a;
  --surface-diff-hidden-weaker: #1b1815;
  --surface-diff-hidden-strong: #4a3213;
  --surface-diff-hidden-stronger: #7a5c2a;

  --text-on-success-base: #b4f28b;
  --text-on-warning-base: #ffc857;
  --text-on-critical-base: #ff8f8f;
  --text-on-info-base: #b9ece7;
  --text-on-info-weak: #8fd8cf;
  --text-on-info-strong: #d6faf5;
  --text-diff-add-base: #8edb5d;
  --text-diff-delete-base: #ff8f8f;

  --syntax-string: #8edb5d;
  --syntax-primitive: #ff8f1f;
  --syntax-property: #c18b2f;
  --syntax-type: #2dd4bf;
  --syntax-constant: #ffc857;
  --syntax-keyword: #c9b99a;
  --syntax-info: #2dd4bf;

  --markdown-heading: #ffe9a8;
  --markdown-text: #f4e6cd;
  --markdown-link: #2dd4bf;
  --markdown-link-text: #8af8ee;
  --markdown-code: #ffc857;
  --markdown-block-quote: #c9b99a;
  --markdown-strong: #ffe9a8;
  --markdown-horizontal-rule: #5a4630;
  --markdown-list-item: #ffc857;
  --markdown-list-enumeration: #ffc857;
  --markdown-image: #2dd4bf;
  --markdown-image-text: #8af8ee;

  --button-ghost-hover: #171d22;
  --button-ghost-hover2: #1f262b;
  --ring: #ffc857;

  --gray-dark-1: #110d0c;
  --gray-dark-2: #171210;
  --gray-dark-3: #1f1815;
  --gray-dark-4: #261d19;
  --gray-dark-5: #2e231d;
  --gray-dark-6: #382b23;
  --gray-dark-7: #45362b;
  --gray-dark-8: #5c4938;
  --gray-dark-9: #735c46;
  --gray-dark-10: #8c6f54;
  --gray-dark-11: #cdb596;
  --gray-dark-12: #f4e6cd;

  --ink-dark-1: #120e0c;
  --ink-dark-2: #181311;
  --ink-dark-3: #211a16;
  --ink-dark-4: #28201b;
  --ink-dark-5: #30261f;
  --ink-dark-6: #3a2e25;
  --ink-dark-7: #48392d;
  --ink-dark-8: #5f4b3a;
  --ink-dark-9: #775d47;
  --ink-dark-10: #906f54;
  --ink-dark-11: #c9b99a;
  --ink-dark-12: #f4e6cd;

  --blue-dark-1: #130f0c;
  --blue-dark-2: #1a1410;
  --blue-dark-3: #241a12;
  --blue-dark-4: #2d2013;
  --blue-dark-5: #372816;
  --blue-dark-6: #47341b;
  --blue-dark-7: #5b4324;
  --blue-dark-8: #785a2f;
  --blue-dark-9: #a35d11;
  --blue-dark-10: #c5771e;
  --blue-dark-11: #ffc857;
  --blue-dark-12: #ffe9a8;

  --cobalt-dark-1: #130f0c;
  --cobalt-dark-2: #1a1410;
  --cobalt-dark-3: #241a12;
  --cobalt-dark-4: #2d2013;
  --cobalt-dark-5: #372816;
  --cobalt-dark-6: #47341b;
  --cobalt-dark-7: #5b4324;
  --cobalt-dark-8: #785a2f;
  --cobalt-dark-9: #a35d11;
  --cobalt-dark-10: #c5771e;
  --cobalt-dark-11: #ffc857;
  --cobalt-dark-12: #ffe9a8;

  --lilac-dark-1: #130f0c;
  --lilac-dark-2: #1b1511;
  --lilac-dark-3: #251b14;
  --lilac-dark-4: #2f2318;
  --lilac-dark-5: #3a2c1d;
  --lilac-dark-6: #473623;
  --lilac-dark-7: #59442d;
  --lilac-dark-8: #6f5638;
  --lilac-dark-9: #a35d11;
  --lilac-dark-10: #c5771e;
  --lilac-dark-11: #ffc857;
  --lilac-dark-12: #ffe9a8;
}

:root[data-color-scheme="dark"] [class*="backdrop-blur"],
:root[data-color-scheme="dark"] [class*="bg-surface-float"] {
  backdrop-filter: none !important;
}

:root[data-color-scheme="dark"] [class*="border-"] {
  border-color: var(--border-base) !important;
}

:root[data-color-scheme="dark"] button,
:root[data-color-scheme="dark"] [role="button"] {
  border-color: var(--border-base) !important;
  background: var(--surface-raised-base) !important;
  color: var(--text-base) !important;
}

:root[data-color-scheme="dark"] button:hover,
:root[data-color-scheme="dark"] [role="button"]:hover {
  border-color: var(--border-hover) !important;
  background: var(--surface-raised-base-hover) !important;
}

:root[data-color-scheme="dark"] input,
:root[data-color-scheme="dark"] textarea,
:root[data-color-scheme="dark"] select {
  border-color: var(--border-base) !important;
  background: var(--input-base) !important;
  color: var(--text-base) !important;
}

:root[data-color-scheme="dark"] input:focus,
:root[data-color-scheme="dark"] textarea:focus,
:root[data-color-scheme="dark"] select:focus {
  border-color: var(--border-focus) !important;
  outline: 1px solid var(--border-focus) !important;
  outline-offset: 0 !important;
}

:root[data-color-scheme="dark"] [data-action="prompt-submit"],
:root[data-color-scheme="dark"] [data-action="prompt-attach"],
:root[data-color-scheme="dark"] [data-action="prompt-permissions"] {
  border-color: var(--border-base) !important;
  background: var(--surface-raised-base) !important;
  color: var(--text-base) !important;
}

:root[data-color-scheme="dark"] [class*="bg-surface-interactive"],
:root[data-color-scheme="dark"] [class*="bg-surface-brand"] {
  border-color: var(--border-interactive-base) !important;
  color: var(--text-interactive-base) !important;
}

:root[data-color-scheme="dark"] [class*="bg-surface-diff-hidden"],
:root[data-color-scheme="dark"] [class*="bg-surface-inset"],
:root[data-color-scheme="dark"] [class*="bg-surface-base-active"],
:root[data-color-scheme="dark"] [class*="bg-surface-base-interactive-active"] {
  background: var(--surface-raised-base) !important;
}

:root[data-color-scheme="dark"] [class*="blue"],
:root[data-color-scheme="dark"] [class*="cobalt"],
:root[data-color-scheme="dark"] [class*="cyan"] {
  color: var(--text-interactive-base) !important;
  border-color: var(--border-interactive-base) !important;
}

:root[data-color-scheme="dark"] [data-action="prompt-submit"] {
  border-color: var(--border-interactive-base) !important;
  color: var(--text-interactive-base) !important;
}
`;
}

export async function proxyOpencodeRequest(args: {
  request: Request;
  targetUrl: URL;
  proxyBasePath?: string;
  opencodeDirectory?: string;
  fallbackBody?: unknown;
}): Promise<Response> {
  const { request, targetUrl, proxyBasePath, opencodeDirectory, fallbackBody } =
    args;

  if (
    proxyBasePath &&
    targetUrl.pathname.endsWith("/hive-opencode-embed.css")
  ) {
    return new Response(buildHiveEmbedCss(), {
      status: 200,
      headers: new Headers({
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-store",
      }),
    });
  }

  const requestBody = resolveProxyRequestBody({ request, fallbackBody });
  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers: buildForwardHeaders({ request, opencodeDirectory }),
    body: requestBody,
    signal: request.signal,
    redirect: "manual",
  });

  const headers = copyResponseHeaders(upstreamResponse.headers);

  if (proxyBasePath && shouldRewriteHtml(upstreamResponse)) {
    const html = await upstreamResponse.text();
    const rewrittenHtml = rewriteHtmlForProxy({
      html,
      proxyBasePath,
      targetUrl,
    });

    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("cache-control", "no-store");

    return new Response(rewrittenHtml, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  if (
    proxyBasePath &&
    shouldRewriteManifest({ response: upstreamResponse, targetUrl })
  ) {
    const manifest = await upstreamResponse.text();
    const rewrittenManifest = rewriteManifestForProxy({
      manifest,
      proxyBasePath,
    });

    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("cache-control", "no-store");

    return new Response(rewrittenManifest, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  if (proxyBasePath && shouldRewriteThemePreload(targetUrl)) {
    const source = await upstreamResponse.text();
    const rewrittenSource = rewriteThemePreloadScript({
      source,
      proxyBasePath,
    });

    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("cache-control", "no-store");

    return new Response(rewrittenSource, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}
