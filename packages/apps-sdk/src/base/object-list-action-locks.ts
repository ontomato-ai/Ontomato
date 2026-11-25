import { reactive } from "vue";

export interface ActiveRowActionLock {
  readonly instanceId: string;
  readonly rowKey: string;
  readonly actionId: string;
}

const activeGroupLocks = reactive(new Map<string, ActiveRowActionLock>());

/** Returns whether any `ObjectList` instance in `group` currently holds the shared row-action mutex. */
export function isActionLockGroupBusy(group: string | undefined): boolean {
  if (!group) return false;
  return activeGroupLocks.has(group);
}

/** Acquires the shared mutex for `group`; returns `false` if another row action in the group is already running. */
export function acquireActionLock(group: string, lock: ActiveRowActionLock): boolean {
  if (activeGroupLocks.has(group)) return false;
  activeGroupLocks.set(group, lock);
  return true;
}

/** Releases the shared mutex for `group` when still held by the same `(instanceId, rowKey, actionId)` lock. */
export function releaseActionLock(group: string, lock: ActiveRowActionLock): void {
  const current = activeGroupLocks.get(group);
  if (
    current
    && current.instanceId === lock.instanceId
    && current.rowKey === lock.rowKey
    && current.actionId === lock.actionId
  ) {
    activeGroupLocks.delete(group);
  }
}

/** Releases any lock still held by `instanceId` across all groups (used on component unmount). */
export function releaseActionLocksForInstance(instanceId: string): void {
  for (const [group, lock] of activeGroupLocks.entries()) {
    if (lock.instanceId === instanceId) {
      activeGroupLocks.delete(group);
    }
  }
}
