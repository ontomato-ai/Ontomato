/**
 * How long one assistant turn may take. It is the deadline of the turn as a whole and the wall-clock and CPU limit of
 * each code execution inside it; it is not a setting, so it has no storage and no interface (a stored value of the
 * retired system model configuration is ignored).
 */
export const QUERY_TIMEOUT_MS = 10 * 60 * 1000;

export function getQueryTimeoutMs(): number {
  return QUERY_TIMEOUT_MS;
}
