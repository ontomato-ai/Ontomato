/** Serializes task admission and account cleanup within the single workbench process. */
const activities = new Map<string, Promise<void>>();

export async function withScheduledUserActivity<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = activities.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  activities.set(userId, finished);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (activities.get(userId) === finished) activities.delete(userId);
  }
}
