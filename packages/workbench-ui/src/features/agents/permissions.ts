/** The operations diagnosis page (the old console's observability page). */
export const OPS_DIAGNOSIS_PERMISSION = "observer";

/** An entry is shown when the user has any one of its permissions. Open source has no permission gate. */
export function anyPermission(can: (permission: string) => boolean, permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(permission));
}
