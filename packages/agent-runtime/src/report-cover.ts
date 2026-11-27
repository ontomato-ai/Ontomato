import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportCoverDirectory, reportCoverImage, reportCoverPathSchema } from "@ontomato/contracts/report-cover";
import { RuntimeError } from "./errors";

const maxAge = 24 * 60 * 60 * 1000;

export async function stageReportCover(workspace: string, image: string) {
  const bytes = Buffer.from(image, "base64");
  const format = reportCoverImage(bytes);
  if (!format || bytes.toString("base64") !== image)
    throw new RuntimeError(400, "INVALID_REPORT_COVER", "The cover must be a PNG or JPEG up to 5 MB and 25 megapixels");

  let workspaceStat;
  try {
    workspaceStat = await lstat(workspace);
  } catch {
    throw new RuntimeError(409, "REPORT_COVER_UNAVAILABLE", "The session workspace is unavailable");
  }
  if (!workspaceStat.isDirectory())
    throw new RuntimeError(409, "REPORT_COVER_UNAVAILABLE", "The session workspace is unavailable");
  const directory = path.join(workspace, reportCoverDirectory);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  // The sticky workspace and host-owned directory keep the worker from replacing upload paths.
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
    throw new RuntimeError(409, "REPORT_COVER_UNAVAILABLE", "The session cover directory is unavailable");
  await chmod(directory, 0o755);
  const now = Date.now();
  for (const name of await readdir(directory)) {
    if (!reportCoverPathSchema.safeParse(`${reportCoverDirectory}/${name}`).success) continue;
    const file = path.join(directory, name);
    if (now - (await lstat(file)).mtimeMs > maxAge) await unlink(file);
  }
  const relative = `${reportCoverDirectory}/${randomUUID()}.${format.extension}`;
  await writeFile(path.join(workspace, relative), bytes, { flag: "wx", mode: 0o444 });
  return { path: relative };
}
