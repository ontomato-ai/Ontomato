import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PptArtifactStore } from "../ppt-artifacts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

it("removes owned PPT files in every domain, retaining other users and unknown ownership", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-user-cleanup-"));
  roots.push(root);
  const store = new PptArtifactStore(root);
  const a = await store.save({ userId: "alice", domainId: "a" }, "A", Buffer.from("a"));
  const b = await store.save({ userId: "alice", domainId: "b" }, "B", Buffer.from("b"));
  const other = await store.save({ userId: "bob", domainId: "a" }, "Other", Buffer.from("other"));
  const orphan = `${randomUUID()}.pptx`;
  const malformed = `${randomUUID()}.json`;
  const unknownDomain = `${randomUUID()}.json`;
  await fs.writeFile(path.join(root, orphan), "orphan");
  await fs.writeFile(path.join(root, malformed), "{bad");
  await fs.writeFile(path.join(root, unknownDomain), JSON.stringify({ userId: "alice" }));
  await fs.writeFile(path.join(root, "shared.json"), JSON.stringify({ userId: "alice", domainId: "a" }));
  await store.deleteByUser("alice");
  expect(await store.read(a.url.split("/").at(-1)!, { userId: "alice", domainId: "a" })).toBeNull();
  expect(await store.read(b.url.split("/").at(-1)!, { userId: "alice", domainId: "b" })).toBeNull();
  expect((await store.read(other.url.split("/").at(-1)!, { userId: "bob", domainId: "a" }))?.buffer.toString()).toBe("other");
  expect((await fs.readdir(root)).sort()).toEqual([
    `${other.url.split("/").at(-1)}.json`, `${other.url.split("/").at(-1)}.pptx`,
    orphan, malformed, unknownDomain, "shared.json",
  ].sort());
  await expect(store.deleteByUser("alice")).resolves.toBeUndefined();
});
