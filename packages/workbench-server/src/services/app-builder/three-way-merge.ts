import type { WorkspaceFile } from "@ontomato/contracts/workspaces";
import { decodeFileText, isManagedApplicationSourcePath } from "./source-codec";

export interface ThreeWayMergeResult {
  files: WorkspaceFile[];
  mergedPaths: string[];
  conflictFiles: string[];
  hasConflicts: boolean;
}

const OURS_LABEL = "source (unpublished)";
const THEIRS_LABEL = "platform (current)";

function toFileMap(files: readonly WorkspaceFile[]): Map<string, WorkspaceFile> {
  const map = new Map<string, WorkspaceFile>();
  for (const file of files) map.set(file.path, file);
  return map;
}

function filesEqual(a: WorkspaceFile | undefined, b: WorkspaceFile | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.encoding === b.encoding) return a.content === b.content;
  return Buffer.from(a.content, a.encoding).equals(Buffer.from(b.content, b.encoding));
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

interface EditHunk {
  baseStart: number;
  baseEnd: number;
  replacement: string[];
}

/**
 * Computes minimal edit hunks transforming `base` lines into `target` lines via LCS DP.
 * Falls back to a single whole-file hunk when line count exceeds the DP guard threshold.
 */
function diffLines(base: readonly string[], target: readonly string[]): EditHunk[] {
  const m = base.length;
  const n = target.length;
  if (m === n && base.every((line, idx) => line === target[idx])) return [];
  if (m * n > 2_000_000) {
    return [{ baseStart: 0, baseEnd: m, replacement: [...target] }];
  }

  // Trim shared prefix and suffix to keep DP compact.
  let prefix = 0;
  while (prefix < m && prefix < n && base[prefix] === target[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < m - prefix &&
    suffix < n - prefix &&
    base[m - 1 - suffix] === target[n - 1 - suffix]
  ) {
    suffix++;
  }

  const bSlice = base.slice(prefix, m - suffix);
  const tSlice = target.slice(prefix, n - suffix);
  const bm = bSlice.length;
  const tn = tSlice.length;

  const dp = new Uint32Array((bm + 1) * (tn + 1));
  const width = tn + 1;
  for (let i = bm - 1; i >= 0; i--) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = tn - 1; j >= 0; j--) {
      if (bSlice[i] === tSlice[j]) {
        dp[row + j] = dp[nextRow + j + 1]! + 1;
      } else {
        const down = dp[nextRow + j]!;
        const right = dp[row + j + 1]!;
        dp[row + j] = down >= right ? down : right;
      }
    }
  }

  const hunks: EditHunk[] = [];
  let i = 0;
  let j = 0;
  let curBaseStart = -1;
  let curReplacement: string[] = [];

  const flush = (baseEnd: number) => {
    if (curBaseStart !== -1) {
      hunks.push({ baseStart: curBaseStart, baseEnd, replacement: curReplacement });
      curBaseStart = -1;
      curReplacement = [];
    }
  };

  while (i < bm || j < tn) {
    if (i < bm && j < tn && bSlice[i] === tSlice[j]) {
      flush(prefix + i);
      i++;
      j++;
    } else if (i < bm && (j === tn || dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!)) {
      if (curBaseStart === -1) curBaseStart = prefix + i;
      i++;
    } else {
      if (curBaseStart === -1) curBaseStart = prefix + i;
      curReplacement.push(tSlice[j]!);
      j++;
    }
  }
  flush(prefix + bm);
  return hunks;
}

function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, idx) => line === b[idx]);
}

function applyHunksToRange(
  base: readonly string[],
  start: number,
  end: number,
  hunks: readonly EditHunk[],
): string[] {
  const out: string[] = [];
  let cursor = start;
  for (const hunk of hunks) {
    while (cursor < hunk.baseStart) out.push(base[cursor++]!);
    out.push(...hunk.replacement);
    cursor = hunk.baseEnd;
  }
  while (cursor < end) out.push(base[cursor++]!);
  return out;
}

/**
 * Line-level 3-way merge of UTF-8 text. Non-overlapping edits from `ours` and `theirs`
 * are both retained; overlapping divergent edits emit standard conflict markers.
 */
export function threeWayMergeText(
  baseText: string,
  oursText: string,
  theirsText: string,
): { text: string; conflicted: boolean } {
  if (oursText === theirsText) return { text: oursText, conflicted: false };
  if (oursText === baseText) return { text: theirsText, conflicted: false };
  if (theirsText === baseText) return { text: oursText, conflicted: false };

  const trailingNewline = oursText.endsWith("\n") || theirsText.endsWith("\n");
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);

  const oursHunks = diffLines(base, ours);
  const theirsHunks = diffLines(base, theirs);

  const result: string[] = [];
  let conflicted = false;
  let baseCursor = 0;
  let oi = 0;
  let ti = 0;

  while (oi < oursHunks.length || ti < theirsHunks.length) {
    const o = oursHunks[oi];
    const th = theirsHunks[ti];

    if (o && (!th || o.baseEnd < th.baseStart || (o.baseEnd === th.baseStart && o.baseStart < th.baseStart))) {
      while (baseCursor < o.baseStart) result.push(base[baseCursor++]!);
      result.push(...o.replacement);
      baseCursor = o.baseEnd;
      oi++;
      continue;
    }

    if (th && (!o || th.baseEnd < o.baseStart || (th.baseEnd === o.baseStart && th.baseStart < o.baseStart))) {
      while (baseCursor < th.baseStart) result.push(base[baseCursor++]!);
      result.push(...th.replacement);
      baseCursor = th.baseEnd;
      ti++;
      continue;
    }

    // Overlapping or adjacent-insertion cluster: gather all transitively overlapping hunks.
    let clusterStart = Math.min(o!.baseStart, th!.baseStart);
    let clusterEnd = Math.max(o!.baseEnd, th!.baseEnd);
    const clusterOurs: EditHunk[] = [];
    const clusterTheirs: EditHunk[] = [];

    let expanded = true;
    while (expanded) {
      expanded = false;
      while (oi < oursHunks.length && oursHunks[oi]!.baseStart <= clusterEnd) {
        const next = oursHunks[oi++]!;
        clusterOurs.push(next);
        if (next.baseEnd > clusterEnd) {
          clusterEnd = next.baseEnd;
          expanded = true;
        }
      }
      while (ti < theirsHunks.length && theirsHunks[ti]!.baseStart <= clusterEnd) {
        const next = theirsHunks[ti++]!;
        clusterTheirs.push(next);
        if (next.baseEnd > clusterEnd) {
          clusterEnd = next.baseEnd;
          expanded = true;
        }
      }
    }

    while (baseCursor < clusterStart) result.push(base[baseCursor++]!);
    const oursChunk = applyHunksToRange(base, clusterStart, clusterEnd, clusterOurs);
    const theirsChunk = applyHunksToRange(base, clusterStart, clusterEnd, clusterTheirs);

    if (linesEqual(oursChunk, theirsChunk)) {
      result.push(...oursChunk);
    } else {
      conflicted = true;
      result.push(`<<<<<<< ${OURS_LABEL}`);
      result.push(...oursChunk);
      result.push("=======");
      result.push(...theirsChunk);
      result.push(`>>>>>>> ${THEIRS_LABEL}`);
    }
    baseCursor = clusterEnd;
  }

  while (baseCursor < base.length) result.push(base[baseCursor++]!);
  return { text: joinLines(result, trailingNewline), conflicted };
}

function conflictMarkerFile(filePath: string, oursBody: string, theirsBody: string): WorkspaceFile {
  const ours = oursBody.endsWith("\n") ? oursBody : `${oursBody}\n`;
  const theirs = theirsBody.endsWith("\n") ? theirsBody : `${theirsBody}\n`;
  return {
    path: filePath,
    encoding: "utf8",
    content: `<<<<<<< ${OURS_LABEL}\n${ours}=======\n${theirs}>>>>>>> ${THEIRS_LABEL}\n`,
  };
}

/**
 * Performs a 3-way merge of workspace files:
 * - `baseFiles`: files at `last_synced_commit` (common ancestor).
 * - `oursFiles`: current workspace working files (including unpublished edits and non-managed files like `test-data/`).
 * - `theirsFiles`: freshly serialized current live platform definition.
 *
 * Non-managed workspace files (e.g. `test-data/*`, notes) are always preserved from `oursFiles`.
 * Unpublished edits in `oursFiles` are retained alongside platform edits in `theirsFiles`;
 * conflicting edits produce standard conflict markers so the user or agent can resolve them explicitly.
 */
export function threeWayMergeFiles(
  baseFiles: readonly WorkspaceFile[],
  oursFiles: readonly WorkspaceFile[],
  theirsFiles: readonly WorkspaceFile[],
): ThreeWayMergeResult {
  const baseMap = toFileMap(baseFiles);
  const oursMap = toFileMap(oursFiles);
  const theirsMap = toFileMap(theirsFiles);

  const allPaths = [...new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()])].sort();
  const outFiles: WorkspaceFile[] = [];
  const mergedPaths: string[] = [];
  const conflictFiles: string[] = [];

  for (const filePath of allPaths) {
    const ours = oursMap.get(filePath);
    const theirs = theirsMap.get(filePath);
    const base = baseMap.get(filePath);

    // Non-managed files (such as `test-data/*`) belong solely to the workspace; never overwrite or delete them.
    if (!isManagedApplicationSourcePath(filePath) && !theirs) {
      if (ours) outFiles.push(ours);
      continue;
    }

    // Identical in ours and theirs (including both deleted).
    if (filesEqual(ours, theirs)) {
      if (ours) outFiles.push(ours);
      continue;
    }

    // Ours did not change relative to base -> take theirs cleanly.
    if (filesEqual(ours, base)) {
      if (theirs) {
        outFiles.push(theirs);
        mergedPaths.push(filePath);
      } else {
        mergedPaths.push(filePath);
      }
      continue;
    }

    // Theirs did not change relative to base -> keep unpublished local changes in ours.
    if (filesEqual(theirs, base)) {
      if (ours) outFiles.push(ours);
      continue;
    }

    // Both sides diverged from base.
    if (!ours && theirs) {
      // Deleted locally, modified in platform -> conflict.
      conflictFiles.push(filePath);
      outFiles.push(
        conflictMarkerFile(
          filePath,
          "(deleted in local unpublished source)",
          decodeFileText(theirs),
        ),
      );
      continue;
    }

    if (ours && !theirs) {
      // Modified locally, deleted in platform -> conflict.
      conflictFiles.push(filePath);
      outFiles.push(
        conflictMarkerFile(
          filePath,
          decodeFileText(ours),
          "(deleted in current platform definition)",
        ),
      );
      continue;
    }

    // Both sides present and modified -> line-level 3-way text merge.
    const merged = threeWayMergeText(
      base ? decodeFileText(base) : "",
      decodeFileText(ours!),
      decodeFileText(theirs!),
    );
    outFiles.push({ path: filePath, encoding: "utf8", content: merged.text });
    if (merged.conflicted) {
      conflictFiles.push(filePath);
    } else {
      mergedPaths.push(filePath);
    }
  }

  return {
    files: outFiles.sort((a, b) => a.path.localeCompare(b.path)),
    mergedPaths: mergedPaths.sort(),
    conflictFiles: conflictFiles.sort(),
    hasConflicts: conflictFiles.length > 0,
  };
}
