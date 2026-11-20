import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { bundledAppsSdkDir } from "../../content/layout";
import { APPS_SDK_CURRENT_PATH, appSdkBuild } from "../../services/app-builder/sdk";

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

/** Serves the image's selected SDK at addresses that revalidate after deployments. */
export function mountAppsSdkStatic(app: express.Express) {
  app.get(`${APPS_SDK_CURRENT_PATH}/*`, (req, res, next) => {
    void appSdkBuild().then(({ version }) => {
      const root = bundledAppsSdkDir(version);
      const name = req.params[0];
      // Only look for compressed siblings inside the SDK root. sendFile checks the final path as well.
      const inside = path.resolve(root, name).startsWith(path.resolve(root) + path.sep);
      const chosen = inside ? ENCODINGS.find(({ encoding, extension }) =>
        accepts(req.headers["accept-encoding"], encoding) && existsSync(path.join(root, name + extension))) : undefined;
      res.set({
        "Access-Control-Allow-Origin": "*",
        Vary: "Accept-Encoding",
        "Cache-Control": "public, max-age=0",
        ...(chosen ? { "Content-Encoding": chosen.encoding } : {}),
      });
      res.type(path.extname(name) || "application/octet-stream");
      res.sendFile(chosen ? name + chosen.extension : name, {
        root, cacheControl: false, lastModified: false, etag: false,
      }, (error) => {
        if (!error) return;
        for (const header of ["Cache-Control", "Content-Encoding", "Content-Type"]) res.removeHeader(header);
        next(error);
      });
    }).catch(next);
  });
}
