import type { AssistantOwner } from "../assistant/store";

const ttlMs = 10 * 60 * 1000;
type CallSecrets = readonly ReadonlyMap<string, unknown>[];
const staged = new Map<string, { secrets: CallSecrets; expiry: ReturnType<typeof setTimeout> }>();
const keyOf = ({ domainId, userId }: AssistantOwner, intentId: string) => JSON.stringify([domainId, userId, intentId]);

function remove(key: string) {
  const entry = staged.get(key);
  if (entry) {
    clearTimeout(entry.expiry);
    staged.delete(key);
  }
  return entry?.secrets;
}

export const panelSecretStore = {
  stage(owner: AssistantOwner, intentId: string, secrets: CallSecrets) {
    const key = keyOf(owner, intentId);
    const expiry = setTimeout(() => staged.delete(key), ttlMs);
    expiry.unref();
    staged.set(key, { secrets, expiry });
  },
  take(owner: AssistantOwner, intentId: string) {
    return remove(keyOf(owner, intentId));
  },
  remove(owner: AssistantOwner, intentId: string) {
    remove(keyOf(owner, intentId));
  },
};
