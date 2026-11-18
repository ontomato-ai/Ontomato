import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { runtimeDataDir } from "../../content/layout";

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
  const root = runtimeDataDir("apps-sdk");
  app.get(/^\/apps-sdk\/.+/, (req, res) => {
    const name = req.path.slice("/apps-sdk/".length);
    const versioned = name.includes("/");
    const chosen = ENCODINGS.find(({ encoding, extension }) =>
      accepts(req.headers["accept-encoding"], encoding) && existsSync(path.join(root, name + extension)));
    res.set({
      "Access-Control-Allow-Origin": "*",
      Vary: "Accept-Encoding",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0",
      ...(chosen ? { "Content-Encoding": chosen.encoding } : {}),
    });
    res.type(path.extname(name) || "application/octet-stream");
    res.sendFile(chosen ? name + chosen.extension : name, {
      root, cacheControl: false, lastModified: false, etag: false,
    });
  });
}
