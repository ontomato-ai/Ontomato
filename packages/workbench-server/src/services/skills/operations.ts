const pending = new Map<string, Promise<void>>();

/** Serialize source changes with publication and admission, not with model execution. */
export async function withDomainSkills<T>(domainId: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(domainId) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => done);
  pending.set(domainId, tail);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (pending.get(domainId) === tail) pending.delete(domainId);
  }
}
