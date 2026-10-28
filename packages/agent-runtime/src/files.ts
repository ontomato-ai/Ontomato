import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  lstat,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import type { RuntimeFileMetadata } from "@ontomato/contracts/agent-runtime-artifacts";

const mediaType = (name: string) =>
  ({
    ".json": "application/json",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".html": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  })[path.extname(name)] ?? "application/octet-stream";
export type OutputFile = RuntimeFileMetadata & { path: string };

/** The runtime's single content-addressed file backend. PG stores only its metadata. */
export class ArtifactFiles {
  constructor(readonly root: string) {}
  private pending: Promise<unknown> = Promise.resolve();
  async withLock<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(action);
    this.pending = next;
    return next;
  }
  private blob(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid content digest");
    return path.join(this.root, "sha256", hash.slice(0, 2), hash);
  }
  async put(bytes: Uint8Array, name: string): Promise<RuntimeFileMetadata> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const target = this.blob(sha256);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + "." + randomUUID();
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, target);
    return { sha256, size: bytes.byteLength, mediaType: mediaType(name) };
  }
  async read(metadata: RuntimeFileMetadata): Promise<Buffer> {
    const bytes = await readFile(this.blob(metadata.sha256));
    if (
      bytes.length !== metadata.size ||
      createHash("sha256").update(bytes).digest("hex") !== metadata.sha256
    )
      throw new Error("Artifact snapshot is corrupt");
    return bytes;
  }
  async remove(hash: string) {
    await rm(this.blob(hash), { force: true });
  }
  async scan(workspace: string): Promise<OutputFile[]> {
    const output = path.join(workspace, "outputs"),
      result: OutputFile[] = [];
    const visit = async (directory: string, prefix: string) => {
      const handle = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      // Linux production walks pinned directory descriptors, including parent components.
      const pinned =
        process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : directory;
      try {
        for (const name of (await readdir(pinned)).sort()) {
          const full = path.join(pinned, name),
            relative = `${prefix}/${name}`,
            stat = await lstat(full);
          if (stat.isSymbolicLink())
            throw new Error("Output snapshots cannot follow symbolic links");
          if (stat.isDirectory()) {
            await visit(full, relative);
            continue;
          }
          if (!stat.isFile())
            throw new Error("Output snapshots require regular files");
          const file = await open(
            full,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const before = await file.stat();
            if (
              before.ino !== stat.ino ||
              before.dev !== stat.dev ||
              before.nlink !== 1
            )
              throw new Error(
                "Output changed during collection or is hard-linked",
              );
            const bytes = await file.readFile(),
              after = await file.stat();
            if (
              before.size !== after.size ||
              before.mtimeMs !== after.mtimeMs ||
              bytes.length !== after.size
            )
              throw new Error("Output changed during collection");
            result.push({ path: relative, ...(await this.put(bytes, name)) });
          } finally {
            await file.close();
          }
        }
      } finally {
        await handle.close();
      }
    };
    await visit(output, "outputs");
    return result;
  }
}
