import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const NOT_FOUND = new Response("NOT_FOUND", { status: 404 });
const LEADING_SLASHES = /^\/+/;

const isFile = (path: string) =>
  existsSync(path) && statSync(path, { throwIfNoEntry: false })?.isFile();

const fileResponse = (path: string, cacheControl: string) =>
  new Response(Bun.file(path), {
    headers: { "Cache-Control": cacheControl },
  });

const htmlResponse = (html: string) =>
  new Response(html, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/html; charset=utf-8",
    },
  });

export const createBundledWebHandler = (webDist: string) => {
  const root = resolve(webDist);
  const indexPath = resolve(root, "index.html");
  if (!isFile(indexPath)) {
    return;
  }
  const indexHtml = readFileSync(indexPath, "utf8").replace(
    "<head>",
    '<head>\n    <base href="/">'
  );

  return (request: Request): Response => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Invalid request path", { status: 400 });
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NOT_FOUND.clone();
    }

    const candidate = resolve(root, pathname.replace(LEADING_SLASHES, ""));
    if (
      (candidate === root || candidate.startsWith(`${root}${sep}`)) &&
      isFile(candidate)
    ) {
      if (candidate === indexPath) {
        return htmlResponse(indexHtml);
      }
      return fileResponse(candidate, "public, max-age=3600");
    }

    if (extname(pathname)) {
      return NOT_FOUND.clone();
    }

    return htmlResponse(indexHtml);
  };
};
