import express, { Express, Request, Response } from "express";
import { webDistDir } from "../content/layout";

// File types a browser fetches as resources. A miss for one of these must not answer with the
// page HTML: the browser would run the HTML as code or style and the page stays blank.
const RESOURCE_EXTENSIONS = new Set([
  "avif", "css", "eot", "gif", "ico", "jpeg", "jpg", "js", "json", "map", "mjs",
  "png", "svg", "ttf", "txt", "webp", "woff", "woff2", "xml",
]);

// The extension named by the last path segment, or null when the address does not name a file.
function resourceExtension(pathName: string): string | null {
  const name = pathName.slice(pathName.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : name.slice(dot + 1).toLowerCase();
}

/**
 * The production web mount: the built pages first, then one rule for every other GET.
 * The platform's routes live behind "#", which browsers never send, so a deep address such as
 * /applications/app-1 arrives as an unknown path. Page addresses redirect to themselves behind
 * the fragment, where the SPA maps them (its own catch-all answers unknown routes); a request
 * that names a file is a plain miss and answers 404.
 */
export function mountWebDist(app: Express): void {
  const staticPath = webDistDir();
  app.use(express.static(staticPath));
  app.get("*", (req: Request, res: Response) => {
    const extension = resourceExtension(req.path);
    if (extension && RESOURCE_EXTENSIONS.has(extension)) {
      res.sendStatus(404);
      return;
    }
    // A gateway serving under a base path forwards it here, so the redirect stays inside it.
    const prefix = String(req.headers["x-forwarded-prefix"] ?? "").replace(/\/+$/, "");
    res.redirect(302, `${prefix}/#${req.originalUrl}`);
  });
}
