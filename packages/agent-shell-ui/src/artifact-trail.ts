import type { AgentArtifactTarget } from "@ontomato/contracts/agent-host";
import { fileName } from "./artifacts";
import type { OpenArtifact } from "./types";

/**
 * Adds an opened artifact onto a trail. When opened from a parent preview (`parentKey`), returns `null` if that
 * parent is no longer the active top item; opening an ancestor returns to that ancestor instead of duplicating it.
 */
export function pushArtifactTrail(
  trail: readonly OpenArtifact[],
  open: OpenArtifact,
  parentKey?: string,
): readonly OpenArtifact[] | null {
  const top = trail.at(-1);
  if (parentKey && top?.key !== parentKey) return null;
  if (parentKey === open.key) return trail;
  if (!parentKey) return [open];
  const ancestor = trail.findIndex((item) => item.key === open.key);
  return ancestor < 0 ? [...trail, open] : [...trail.slice(0, ancestor), open];
}

/** Pops the top artifact when its key matches, returning the remaining trail or `null` if the key is not on top. */
export function popArtifactTrail(trail: readonly OpenArtifact[], key: string): readonly OpenArtifact[] | null {
  if (trail.at(-1)?.key !== key) return null;
  return trail.slice(0, -1);
}

/**
 * Applies a reply link's title to the currently active artifact when that artifact is still titled by its bare file
 * name; returns the original array unchanged otherwise.
 */
export function nameArtifactInTrail(
  trail: readonly OpenArtifact[],
  key: string,
  title: string,
): readonly OpenArtifact[] {
  const current = trail.at(-1);
  if (!current || current.key !== key) return trail;
  if (current.title !== fileName(current.artifact.path) || title === current.title) return trail;
  return [...trail.slice(0, -1), { ...current, title }];
}

/** Converts an open artifact into the serializable target shared between chat and preview components. */
export function artifactTargetOf(open: OpenArtifact): AgentArtifactTarget {
  return {
    sessionId: open.artifact.sessionId,
    runId: open.artifact.runId,
    path: open.artifact.path,
    ...(open.title ? { title: open.title } : {}),
  };
}

/** Returns true when two artifact targets identify the same file within the same session and run. */
export function sameArtifactTarget(
  left: AgentArtifactTarget | null | undefined,
  right: AgentArtifactTarget | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.sessionId === right.sessionId && left.runId === right.runId && left.path === right.path;
}
