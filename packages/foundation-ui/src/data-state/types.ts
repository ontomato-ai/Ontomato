/**
 * What one named datum of a member is, as the platform and the instance show it: its value once the owner answered with
 * one, the owner's empty answer, a reason it could not be read, no permission, still on its way, or not asked for yet
 * because a selection it needs is missing. Only `ready` carries a value; every other state has one presentation for the
 * whole product.
 */
export type DataStateResult<T = unknown> =
  | { status: "ready"; value: T }
  | { status: "empty" }
  /** `retry`, when given, reads the datum again (a read the platform never answered, say). */
  | { status: "error"; message: string; retry?: () => void }
  | { status: "forbidden" }
  | { status: "loading" }
  | { status: "awaiting" };

/** The words of the states the owner does not word itself, in the reader's language, from the caller's messages. */
export interface DataStateLabels {
  empty: string;
  forbidden: string;
  /** A selection the datum needs is missing: say what to do, not that nothing was found. */
  awaiting: string;
  /** The button that reads a failed datum again. */
  retry: string;
}
