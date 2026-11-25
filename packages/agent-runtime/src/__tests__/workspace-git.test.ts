import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceGit } from "../workspace-git";
import { removeWorkerFiles } from "../worker";
import { WORKSPACE_FILE_BYTES } from "@ontomato/contracts/workspaces";
let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function repository() {
  root = await mkdtemp(path.join(os.tmpdir(), "ontomato-workspace-"));
  const git = new WorkspaceGit(path.join(root, "source"));
  await git.initialize();
  return git;
}
it("exports a selected commit independently of the draft and restores without rewriting history", async () => {
  const git = await repository();
  const initial = await git.head();
  await git.replace([{ path: "index.html", content: "first", encoding: "utf8" }, { path: "image.bin", content: "AAEC/w==", encoding: "base64" }]);
  const first = await git.commit("First turn");
  expect(await git.commit("Unchanged turn")).toBe(first);
  await git.replace([{ path: "index.html", content: "second", encoding: "utf8" }]);
  const second = await git.commit("Second turn");
  await writeFile(path.join(git.tree, "index.html"), "uncommitted");
  const exported = await git.export(first);
  expect(Buffer.from(exported.files.find(f => f.path === "index.html")!.content, "base64").toString()).toBe("first");
  expect(exported.files.find(f => f.path === "image.bin")!.content).toBe("AAEC/w==");
  expect(await git.diff(first, second)).toContain("+second");
  await git.replace(exported.files);
  const restored = await git.commit(`Restore ${first}`);
  expect(restored).not.toBe(first);
  expect((await git.history(0, 10)).map(c => c.id)).toEqual([restored, second, first, initial]);
  expect((await git.content("index.html")).toString()).toBe("first");
});
it("rejects invalid uploads before replacing source and never reads outside the tree", async () => {
  const git = await repository();
  await git.replace([{ path: "index.html", content: "kept", encoding: "utf8" }]);
  await expect(git.replace([{ path: "../escape", content: "bad", encoding: "utf8" }])).rejects.toThrow();
  await expect(git.replace([{ path: "big", content: "a".repeat(WORKSPACE_FILE_BYTES + 1), encoding: "utf8" }])).rejects.toThrow("size limit");
  expect((await git.content("index.html")).toString()).toBe("kept");
  await writeFile(path.join(root, "private"), "private");
  await symlink(path.join(root, "private"), path.join(git.tree, "link"));
  await expect(git.content("link")).rejects.toThrow("escapes");
});
it("deleting a session's source mapping preserves the global repository", async () => {
  const git = await repository();
  await writeFile(path.join(git.tree, "index.html"), "persistent");
  const session = path.join(root, "session");
  await mkdir(session);
  await symlink(git.tree, path.join(session, "work"));
  await removeWorkerFiles(session);
  expect(await readFile(path.join(git.tree, "index.html"), "utf8")).toBe("persistent");
  await git.commit("Next session");
  expect((await git.history(0, 10))[0].message).toBe("Next session");
});

it("keeps a sync's live snapshot readable as an ancestor without replacing the working history", async () => {
  const git = await repository();
  const file = (content: string) => ({ path: "application.json", content, encoding: "utf8" as const });
  await git.replace([file("Unpublished")]);
  const previous = await git.commit("Unpublished change");
  const result = await git.importMerge([file("Merged source")], [file("Live definition")], "Sync");
  expect(await git.head()).toBe(result.commit);
  expect((await git.history(0, 1))[0]?.parentIds).toEqual([previous, result.baselineCommit]);
  expect(await git.content("application.json", result.baselineCommit)).toEqual(Buffer.from("Live definition"));
  expect(await git.content("application.json", previous)).toEqual(Buffer.from("Unpublished"));
  expect(await git.content("application.json")).toEqual(Buffer.from("Merged source"));
});
