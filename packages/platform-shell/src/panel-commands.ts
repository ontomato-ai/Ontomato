import type { PanelCommand, PanelManifest } from "@ontomato/contracts/panel-manifest";

/**
 * Structural equality for JSON state values (primitives, arrays, and plain objects independent of key order).
 * Scalars and `null` compare with `Object.is`.
 */
function jsonValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonValuesEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && jsonValuesEqual(left[key], right[key]));
}

/**
 * Returns whether every target state field of a header `do.set` command already holds the value the command would write,
 * so the host can disable redundant state transitions (such as clicking "New" while already in create mode) without
 * extending the command contract.
 *
 * Non-`set` commands (`invoke`, `open`), empty field maps, non-`deepLink` target or source fields, and non-literal/non-state
 * sources conservatively return `false` so the host never disables a command whose effect it cannot verify.
 */
export function isSetCommandSatisfied(
  command: PanelCommand | undefined,
  manifest: Pick<PanelManifest, "state">,
  state: Readonly<Record<string, unknown>>,
): boolean {
  if (!command || !("set" in command.do)) return false;
  const entries = Object.entries(command.do.set.fields);
  if (entries.length === 0) return false;

  for (const [field, source] of entries) {
    // Only deep-linkable fields are reported into host state; never assume an unreported field is null.
    if (manifest.state[field]?.deepLink !== true) return false;
    // `deepLinkable()` omits null fields, so absence in reported host state represents null.
    const current = Object.hasOwn(state, field) ? (state[field] ?? null) : null;

    let target: unknown;
    if ("literal" in source) {
      target = source.literal ?? null;
    } else if ("state" in source) {
      if (manifest.state[source.state]?.deepLink !== true) return false;
      target = Object.hasOwn(state, source.state) ? (state[source.state] ?? null) : null;
    } else {
      return false;
    }

    if (!jsonValuesEqual(current, target)) return false;
  }

  return true;
}
