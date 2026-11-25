import type { DataAdapterTestResult } from "@ontomato/contracts/data-adapters";

/** Outcome of a single data adapter connection test: structured report or verbatim failure message. */
export type DataAdapterTestOutcome =
  | { readonly ok: true; readonly result: DataAdapterTestResult }
  | { readonly ok: false; readonly message: string };
