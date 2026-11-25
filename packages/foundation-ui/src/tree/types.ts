/** Input entry for `PathTree` in path mode: either a raw slash-separated path or an item with an opaque owner key. */
export type PathTreeItem =
  | string
  | {
      readonly key: string;
      readonly path: string;
      readonly label?: string;
    };

/** Input entry for `PathTree` in hierarchy mode: a flat record linked to its parent by key. */
export interface ParentTreeItem {
  readonly key: string;
  readonly parentKey?: string | null;
  readonly label: string;
  readonly subtitle?: string;
}

/** Normalized item emitted when a reader selects a node in `PathTree`. */
export interface PathTreeFile {
  readonly key: string;
  readonly path: string;
  readonly label: string;
}

/** One node in a folder/file or parent-linked hierarchy tree. */
export interface PathTreeNode {
  readonly kind: "folder" | "file";
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly subtitle?: string;
  /** Whether clicking the node body selects it (false for synthetic intermediate folders in `selectableFolders` mode). */
  readonly selectable?: boolean;
  readonly children?: readonly PathTreeNode[];
}

export interface BuildPathTreeOptions {
  /** Merge items whose path matches an ancestor folder onto that folder node instead of creating a duplicate sibling. */
  readonly mergeFolderItems?: boolean;
}

interface MutableNode {
  kind: "folder" | "file";
  key: string;
  path: string;
  label: string;
  subtitle?: string;
  selectable?: boolean;
  children?: MutableNode[];
}

/**
 * Builds a folder/file tree from flat slash-separated paths: folders come before files and siblings are ordered by
 * name at every level. Opaque keys supplied on items are preserved on leaf file nodes without alteration.
 */
export function buildPathTree(
  items: readonly PathTreeItem[],
  options: BuildPathTreeOptions = {},
): readonly PathTreeNode[] {
  const mergeFolderItems = options.mergeFolderItems === true;
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
      if (mergeFolderItems) {
        let node = level.find((candidate) => candidate.path === path);
        if (!node) {
          node = isFile
            ? { kind: "file", key, path, label, selectable: true }
            : { kind: "folder", key, path, label, selectable: false, children: [] };
          level.push(node);
        } else if (isFile) {
          node.key = key;
          node.label = label;
          node.selectable = true;
        } else if (node.kind === "file") {
          node.kind = "folder";
          node.children = [];
        }
        if (!isFile) level = node.children!;
        return;
      }
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

/**
 * Builds a parent-linked hierarchy tree from flat items while preserving the caller's sibling order at every level.
 * Items with missing, unknown, self-referential, or cycle-closing parents become root nodes so every item stays visible.
 */
export function buildParentTree(items: readonly ParentTreeItem[]): readonly PathTreeNode[] {
  interface DraftNode {
    readonly key: string;
    readonly rawParentKey: string | null;
    readonly label: string;
    readonly subtitle?: string;
    attachedParentKey: string | null;
    readonly children: DraftNode[];
  }

  const byKey = new Map<string, DraftNode>();
  const ordered: DraftNode[] = [];
  for (const item of items) {
    if (!item.key || byKey.has(item.key)) continue;
    const rawParentKey = typeof item.parentKey === "string" && item.parentKey.trim().length > 0
      ? item.parentKey.trim()
      : null;
    const draft: DraftNode = {
      key: item.key,
      rawParentKey,
      label: item.label,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      attachedParentKey: null,
      children: [],
    };
    byKey.set(item.key, draft);
    ordered.push(draft);
  }

  const roots: DraftNode[] = [];
  const createsCycle = (nodeKey: string, candidateParentKey: string): boolean => {
    let cursor: string | null = candidateParentKey;
    const visited = new Set<string>();
    while (cursor !== null) {
      if (cursor === nodeKey) return true;
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = byKey.get(cursor)?.attachedParentKey ?? null;
    }
    return false;
  };

  for (const node of ordered) {
    const parent = node.rawParentKey && node.rawParentKey !== node.key ? byKey.get(node.rawParentKey) : undefined;
    if (parent && !createsCycle(node.key, parent.key)) {
      node.attachedParentKey = parent.key;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const freeze = (draft: DraftNode): PathTreeNode => {
    if (draft.children.length > 0) {
      return {
        kind: "folder",
        key: draft.key,
        path: draft.key,
        label: draft.label,
        ...(draft.subtitle ? { subtitle: draft.subtitle } : {}),
        selectable: true,
        children: draft.children.map(freeze),
      };
    }
    return {
      kind: "file",
      key: draft.key,
      path: draft.key,
      label: draft.label,
      ...(draft.subtitle ? { subtitle: draft.subtitle } : {}),
      selectable: true,
    };
  };

  return roots.map(freeze);
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

/** First selectable node (branch or leaf) in depth-first rendered tree order, or `null` when none exist. */
export function firstTreeNode(nodes: readonly PathTreeNode[]): PathTreeFile | null {
  for (const node of nodes) {
    if (node.selectable !== false) return { key: node.key, path: node.path, label: node.label };
    if (node.children) {
      const found = firstTreeNode(node.children);
      if (found) return found;
    }
  }
  return null;
}

/** Filters a path or hierarchy tree by case-insensitive substring match against label, subtitle, path, and record key. */
export function filterPathTree(nodes: readonly PathTreeNode[], keyword: string): readonly PathTreeNode[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return nodes;
  const matched: PathTreeNode[] = [];
  for (const node of nodes) {
    const selfHit =
      node.label.toLowerCase().includes(query)
      || node.path.toLowerCase().includes(query)
      || (node.subtitle?.toLowerCase().includes(query) ?? false)
      || ((node.kind === "file" || node.selectable === true) && node.key.toLowerCase().includes(query));
    if (node.kind === "file" || !node.children?.length) {
      if (selfHit) matched.push(node);
      continue;
    }
    if (selfHit) {
      matched.push(node);
      continue;
    }
    const children = filterPathTree(node.children, query);
    if (children.length > 0) {
      matched.push({ ...node, children });
    }
  }
  return matched;
}

/** Alias of `filterPathTree` for parent-linked hierarchy trees: keeps matched nodes along with their ancestor chain. */
export const filterHierarchyTree = filterPathTree;
