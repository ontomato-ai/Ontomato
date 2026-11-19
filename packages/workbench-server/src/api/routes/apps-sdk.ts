import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { installedAppsSdkDir } from "../../content/layout";

/** Precompressed siblings written next to each SDK text file, in the order a browser may prefer them. */
const ENCODINGS = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
] as const;

function accepts(header: string | undefined, encoding: string) {
  return (header ?? "")
    .split(",")
    .some((entry) => entry.trim().split(";")[0] === encoding);
}

/**
 * Serves the installed apps SDK versions. A file under a version directory never changes, so it is cached
 * forever; the unversioned entry file stays revalidatable. Compressed siblings are chosen per request and
 * keep the content type of the original file.
 */
export function mountAppsSdkStatic(app: express.Express) {
  const root = installedAppsSdkDir();
  app.get(/^\/apps-sdk\/.+/, (req, res, next) => {
    const name = req.path.slice("/apps-sdk/".length);
    const versioned = name.includes("/");
    // The request path is outside input: only look for a compressed sibling inside the SDK root. `sendFile` below
    // refuses anything that leaves the root on its own.
    const inside = path.resolve(root, name).startsWith(path.resolve(root) + path.sep);
    const chosen = inside ? ENCODINGS.find(({ encoding, extension }) =>
      accepts(req.headers["accept-encoding"], encoding) && existsSync(path.join(root, name + extension))) : undefined;
    res.set({
      "Access-Control-Allow-Origin": "*",
      Vary: "Accept-Encoding",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0",
      ...(chosen ? { "Content-Encoding": chosen.encoding } : {}),
    });
    res.type(path.extname(name) || "application/octet-stream");
    res.sendFile(chosen ? name + chosen.extension : name, {
      root, cacheControl: false, lastModified: false, etag: false,
    }, (error) => {
      if (!error) return;
      // What describes the file goes out only with the file: a missing path must not be kept by the browser for a year.
      for (const header of ["Cache-Control", "Content-Encoding", "Content-Type"]) res.removeHeader(header);
      next(error);
    });
  });
}
