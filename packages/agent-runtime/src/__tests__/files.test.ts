import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactFiles } from "../files";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it("links delivered artifacts without copying bytes and keeps them out of ordinary output scans", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-files-"));
  directories.push(root);
  const files = new ArtifactFiles(root);
  const bytes = Buffer.from("formal dataset bytes");
  const metadata = await files.put(bytes, "out.dataset.json");
  const workspace = path.join(root, "session", "workspace");
  const destination = path.join(workspace, "outputs", "agents", "task", "artifact-out.dataset.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await files.link(metadata, destination);
  expect((await stat(destination)).ino).toBe((await stat(path.join(root, "sha256", metadata.sha256.slice(0, 2), metadata.sha256))).ino);
  expect(await readFile(destination)).toEqual(bytes);

  await writeFile(path.join(workspace, "outputs", "ordinary.txt"), "ordinary");
  const scanned = await files.scan(workspace);
  expect(scanned.map((file) => file.path)).toEqual(["outputs/ordinary.txt"]);
});

it("returns no files when the outputs directory is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-files-missing-"));
  directories.push(root);
  const files = new ArtifactFiles(root);
  const workspace = path.join(root, "session", "workspace");
  await mkdir(workspace, { recursive: true });

  await expect(files.scan(workspace)).resolves.toEqual([]);
});

it("rethrows non-ENOENT errors when scanning outputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-files-error-"));
  directories.push(root);
  const files = new ArtifactFiles(root);

  const fileWorkspace = path.join(root, "file-session", "workspace");
  await mkdir(fileWorkspace, { recursive: true });
  await writeFile(path.join(fileWorkspace, "outputs"), "not-a-directory");
  await expect(files.scan(fileWorkspace)).rejects.toMatchObject({ code: "ENOTDIR" });

  const symlinkWorkspace = path.join(root, "symlink-session", "workspace");
  const targetDir = path.join(root, "target");
  await mkdir(symlinkWorkspace, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  await symlink(targetDir, path.join(symlinkWorkspace, "outputs"));
  await expect(files.scan(symlinkWorkspace)).rejects.toThrow();
});
