import type { PanelCapacityAdmission, PanelCapacityPort, PanelCapacityRequest } from "@ontomato/contracts/panel-host";

/*
 * The panel instances one display host keeps (design 7.2.1): the instance shown and the clean ones the reader left last,
 * up to a fixed number of top-level instances. Only a clean instance is ever kept — a page left with unsaved changes is
 * left through the platform's unsaved-changes question and goes with them — so there is always one to make room with:
 * the instance shown longest ago, which may be the one being left. The collection only answers whether an instance is
 * still there and which ones go; what is shown, and where, stays its display's.
 */

/** A display host's kept instances: the contract's admission port, and the release of an instance that ended itself. */
export interface PanelCapacity extends PanelCapacityPort {
  /** Every kept instance is clean, so one can always make room: a switch is never refused here. */
  admit(request: PanelCapacityRequest): Extract<PanelCapacityAdmission, { kind: "admitted" }>;
  /** An instance its display ended (its relation was withdrawn, its application left): it is no longer kept. */
  release(instance: string): void;
}

export function panelCapacity(limit: number): PanelCapacity {
  /** Each kept instance, with when it was last shown, in the order the pages were shown. */
  const shown = new Map<string, number>();
  let showings = 0;
  return {
    admit({ current, next, departure }) {
      const moving = current !== null && current.instance !== next?.instance;
      const reclaim = moving && departure === "discarded" ? [current.instance] : [];
      const kind = next === null ? "none" : shown.has(next.instance) ? "reuse" : "mount";
      if (kind === "mount") {
        const remaining = [...shown.entries()].filter(([instance]) => !reclaim.includes(instance));
        if (remaining.length >= limit) reclaim.push(remaining.sort(([, one], [, other]) => one - other)[0]![0]);
      }
      return {
        kind: "admitted", next: kind, reclaim,
        commit() {
          for (const instance of reclaim) shown.delete(instance);
          if (next) shown.set(next.instance, ++showings);
        },
      };
    },
    release(instance) {
      shown.delete(instance);
    },
  };
}
