import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiffPatch } from "../diff-patch.ts";

test("parseDiffPatch returns an empty summary for empty or non-diff text", () => {
  assert.deepEqual(parseDiffPatch(""), { files: [], fileCount: 0, added: 0, removed: 0 });
  assert.deepEqual(parseDiffPatch("   \n\n"), { files: [], fileCount: 0, added: 0, removed: 0 });
  assert.deepEqual(parseDiffPatch("---\ntitle: Not a diff\n---\nHello world\n"), {
    files: [],
    fileCount: 0,
    added: 0,
    removed: 0,
  });
});

test("parseDiffPatch parses added, modified, deleted, binary, multi-hunk, and no-newline entries", () => {
  const patch = [
    "diff --git a/src/new-file.ts b/src/new-file.ts",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/src/new-file.ts",
    "@@ -0,0 +1,2 @@",
    "+export const answer = 42;",
    "+export const ok = true;",
    "\\ No newline at end of file",
    "diff --git a/src/app.ts b/src/app.ts",
    "index 2222222..3333333 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -10,3 +10,4 @@ function greet() {",
    " const name = 'world';",
    "-console.log('hi');",
    "+console.log('hello');",
    "+console.log(name);",
    " return true;",
    "@@ -30,2 +31,1 @@ function bye() {",
    "-cleanup();",
    " done();",
    "diff --git a/old.txt b/old.txt",
    "deleted file mode 100644",
    "index 4444444..0000000",
    "--- a/old.txt",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-legacy line 1",
    "-legacy line 2",
    "diff --git a/assets/logo.png b/assets/logo.png",
    "index 5555555..6666666 100644",
    "Binary files a/assets/logo.png and b/assets/logo.png differ",
    "",
  ].join("\n");

  const summary = parseDiffPatch(patch);
  assert.equal(summary.fileCount, 4);
  assert.equal(summary.added, 4);
  assert.equal(summary.removed, 4);

  const [addedFile, modifiedFile, deletedFile, binaryFile] = summary.files;

  assert.equal(addedFile.path, "src/new-file.ts");
  assert.equal(addedFile.change, "added");
  assert.equal(addedFile.binary, false);
  assert.equal(addedFile.added, 2);
  assert.equal(addedFile.removed, 0);
  assert.deepEqual(addedFile.lines, [
    { kind: "hunk", text: "@@ -0,0 +1,2 @@", before: null, after: null },
    { kind: "add", text: "export const answer = 42;", before: null, after: 1 },
    { kind: "add", text: "export const ok = true;", before: null, after: 2 },
    { kind: "note", text: "\\ No newline at end of file", before: null, after: null },
  ]);

  assert.equal(modifiedFile.path, "src/app.ts");
  assert.equal(modifiedFile.change, "modified");
  assert.equal(modifiedFile.binary, false);
  assert.equal(modifiedFile.added, 2);
  assert.equal(modifiedFile.removed, 2);
  assert.deepEqual(modifiedFile.lines, [
    { kind: "hunk", text: "@@ -10,3 +10,4 @@ function greet() {", before: null, after: null },
    { kind: "context", text: "const name = 'world';", before: 10, after: 10 },
    { kind: "remove", text: "console.log('hi');", before: 11, after: null },
    { kind: "add", text: "console.log('hello');", before: null, after: 11 },
    { kind: "add", text: "console.log(name);", before: null, after: 12 },
    { kind: "context", text: "return true;", before: 12, after: 13 },
    { kind: "hunk", text: "@@ -30,2 +31,1 @@ function bye() {", before: null, after: null },
    { kind: "remove", text: "cleanup();", before: 30, after: null },
    { kind: "context", text: "done();", before: 31, after: 31 },
  ]);

  assert.equal(deletedFile.path, "old.txt");
  assert.equal(deletedFile.change, "deleted");
  assert.equal(deletedFile.binary, false);
  assert.equal(deletedFile.added, 0);
  assert.equal(deletedFile.removed, 2);
  assert.deepEqual(deletedFile.lines, [
    { kind: "hunk", text: "@@ -1,2 +0,0 @@", before: null, after: null },
    { kind: "remove", text: "legacy line 1", before: 1, after: null },
    { kind: "remove", text: "legacy line 2", before: 2, after: null },
  ]);

  assert.equal(binaryFile.path, "assets/logo.png");
  assert.equal(binaryFile.change, "modified");
  assert.equal(binaryFile.binary, true);
  assert.equal(binaryFile.added, 0);
  assert.equal(binaryFile.removed, 0);
  assert.deepEqual(binaryFile.lines, []);
});

test("parseDiffPatch handles CRLF endings, GIT binary patches, and path updates from +++ b/", () => {
  const patch = [
    "diff --git a/docs/old name.md b/docs/new name.md",
    "rename from docs/old name.md",
    "rename to docs/new name.md",
    "--- a/docs/old name.md",
    "+++ b/docs/new name.md",
    "@@ -1 +1 @@",
    "-Old",
    "+New",
    "diff --git a/bin/data.bin b/bin/data.bin",
    "new file mode 100644",
    "GIT binary patch",
    "literal 0",
    "HcmV?d00001",
  ].join("\r\n");

  const summary = parseDiffPatch(patch);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.files[0].path, "docs/new name.md");
  assert.deepEqual(summary.files[0].lines, [
    { kind: "hunk", text: "@@ -1 +1 @@", before: null, after: null },
    { kind: "remove", text: "Old", before: 1, after: null },
    { kind: "add", text: "New", before: null, after: 1 },
  ]);
  assert.equal(summary.files[1].path, "bin/data.bin");
  assert.equal(summary.files[1].change, "added");
  assert.equal(summary.files[1].binary, true);
});
