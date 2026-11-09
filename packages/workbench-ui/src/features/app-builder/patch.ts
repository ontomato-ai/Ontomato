/** One line of a file's changes as the changes view shows it. */
export interface PatchLine {
  kind: "hunk" | "context" | "add" | "remove" | "note";
  text: string;
  /** The line's number in the file before and after the change, where it has one. */
  before: number | null;
  after: number | null;
}

export interface PatchFile {
  path: string;
  change: "added" | "modified" | "deleted";
  binary: boolean;
  added: number;
  removed: number;
  lines: PatchLine[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The files of the patch the workspace returns (`git diff`), each line numbered from its hunk header. Only git's own
 * markers are read; the text of a line is shown as it is.
 */
export function patchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let before = 0;
  let after = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: line.slice(line.lastIndexOf(" b/") + 3), change: "modified", binary: false, added: 0, removed: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    const hunk = HUNK.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "hunk", text: line, before: null, after: null });
    } else if (!inHunk) {
      if (line.startsWith("new file mode")) file.change = "added";
      else if (line.startsWith("deleted file mode")) file.change = "deleted";
      else if (line.startsWith("Binary files")) file.binary = true;
      else if (line.startsWith("+++ b/")) file.path = line.slice(6);
    } else if (line.startsWith("+")) {
      file.lines.push({ kind: "add", text: line.slice(1), before: null, after: after++ });
      file.added++;
    } else if (line.startsWith("-")) {
      file.lines.push({ kind: "remove", text: line.slice(1), before: before++, after: null });
      file.removed++;
    } else if (line.startsWith(" ")) {
      file.lines.push({ kind: "context", text: line.slice(1), before: before++, after: after++ });
    } else if (line.startsWith("\\")) {
      file.lines.push({ kind: "note", text: line, before: null, after: null });
    }
  }
  return files;
}
