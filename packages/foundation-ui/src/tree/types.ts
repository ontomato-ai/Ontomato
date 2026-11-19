/** Input entry for `PathTree`: either a raw slash-separated path or an item with an opaque owner key. */
export type PathTreeItem =
  | string
  | {
      readonly key: string;
      readonly path: string;
      readonly label?: string;
    };

/** Normalized file item emitted when a reader selects a file in `PathTree`. */
export interface PathTreeFile {
  readonly key: string;
  readonly path: string;
  readonly label: string;
}

/** One node in the folder/file tree built from flat slash-separated paths. */
export interface PathTreeNode {
  readonly kind: "folder" | "file";
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly children?: readonly PathTreeNode[];
}

interface MutableNode {
  kind: "folder" | "file";
  key: string;
  path: string;
  label: string;
  children?: MutableNode[];
}

/**
 * Builds a folder/file tree from flat slash-separated paths: folders come before files and siblings are ordered by
 * name at every level. Opaque keys supplied on items are preserved on leaf file nodes without alteration.
 */
export function buildPathTree(items: readonly PathTreeItem[]): readonly PathTreeNode[] {
  const root: MutableNode[] = [];
  for (const raw of items) {
    const entry = typeof raw === "string" ? { key: raw, path: raw, label: undefined } : raw;
    const parts = entry.path.split("/").filter(Boolean);
    if (!parts.length) continue;
    let level = root;
    parts.forEach((segment, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      const key = isFile ? entry.key : `folder:${path}`;
      const label = isFile && entry.label ? entry.label : segment;
      let node = level.find((candidate) => candidate.kind === (isFile ? "file" : "folder") && candidate.path === path);
      if (!node) {
        node = isFile
          ? { kind: "file", key, path, label }
          : { kind: "folder", key, path, label, children: [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    });
  }
  const sortLevel = (nodes: MutableNode[]) => {
    nodes.sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file") || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    for (const node of nodes) if (node.children) sortLevel(node.children);
  };
  sortLevel(root);
  return root;
}

/** First file node in depth-first rendered tree order, or `null` when the tree contains no files. */
export function firstTreeFile(nodes: readonly PathTreeNode[]): PathTreeFile | null {
  for (const node of nodes) {
    if (node.kind === "file") return { key: node.key, path: node.path, label: node.label };
    if (node.children) {
      const found = firstTreeFile(node.children);
      if (found) return found;
    }
  }
  return null;
}
