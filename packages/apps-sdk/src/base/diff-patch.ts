/** One line of a unified diff file as rendered by ObjectTextReader. */
export interface DiffPatchLine {
  kind: "hunk" | "context" | "add" | "remove" | "note";
  text: string;
  /** The line's number in the file before and after the change, where applicable. */
  before: number | null;
  after: number | null;
}

export interface DiffPatchFile {
  path: string;
  change: "added" | "modified" | "deleted";
  binary: boolean;
  added: number;
  removed: number;
  lines: DiffPatchLine[];
}

export interface DiffPatchSummary {
  files: DiffPatchFile[];
  fileCount: number;
  added: number;
  removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function extractDiffGitPath(line: string): string {
  const marker = line.lastIndexOf(" b/");
  if (marker !== -1) return line.slice(marker + 3);
  return line.slice("diff --git ".length).trim();
}

/**
 * Parses a standard unified git diff into per-file hunks, line numbers, and summary counts.
 * Returns an empty summary when the input is empty or contains no parseable `diff --git` file entries.
 */
export function parseDiffPatch(patch: string): DiffPatchSummary {
  const files: DiffPatchFile[] = [];
  if (!patch) {
    return { files, fileCount: 0, added: 0, removed: 0 };
  }

  let file: DiffPatchFile | null = null;
  let before = 0;
  let after = 0;
  let inHunk = false;

  for (const rawLine of patch.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      file = {
        path: extractDiffGitPath(line),
        change: "modified",
        binary: false,
        added: 0,
        removed: 0,
        lines: [],
      };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "hunk", text: line, before: null, after: null });
    } else if (!inHunk) {
      if (line.startsWith("new file mode")) file.change = "added";
      else if (line.startsWith("deleted file mode")) file.change = "deleted";
      else if (line.startsWith("Binary files") || line === "GIT binary patch") file.binary = true;
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

  let added = 0;
  let removed = 0;
  for (const entry of files) {
    added += entry.added;
    removed += entry.removed;
  }

  return {
    files,
    fileCount: files.length,
    added,
    removed,
  };
}
