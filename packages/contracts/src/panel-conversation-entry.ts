import { z } from "zod";
import { defaultAgentSchema } from "./default-agent";

export const pageComposerAgentTargetSchema = z.discriminatedUnion("kind", [
  ...defaultAgentSchema.options,
  z.object({ kind: z.literal("page-default") }).strict(),
]);

/**
 * The trusted projection declaration owns the exact target and the optional opening sentence for this entry: written
 * out (`prefill`), or a key into the placing panel's `content.messages` (`prefillKey`), read in the reader's language and
 * else the deployment's default — a platform panel ships to every language, so its sentence is a key. One or the other.
 */
export const panelConversationEntryFields = z.object({
  target: pageComposerAgentTargetSchema,
  prefill: z.string().optional(),
  prefillKey: z.string().min(1).optional(),
}).strict();
export const panelConversationEntrySchema = panelConversationEntryFields.refine(
  (entry) => entry.prefill === undefined || entry.prefillKey === undefined,
  { message: "Write the opening sentence out or name its message key, not both", path: ["prefillKey"] },
);
export type PanelConversationEntry = z.infer<typeof panelConversationEntrySchema>;

/**
 * The `prefillKey`s of these entries a panel's messages do not hold in each locale they declare: shown, such a key
 * would be its own text. A panel that declares no messages holds none.
 */
export function missingEntryMessageKeys(
  entries: readonly (PanelConversationEntry | undefined)[], messages: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
): { key: string; locale: string | null }[] {
  const locales = Object.entries(messages ?? {});
  return entries.flatMap((entry): { key: string; locale: string | null }[] => {
    const key = entry?.prefillKey;
    if (key === undefined) return [];
    if (!locales.length) return [{ key, locale: null }];
    return locales.filter(([, held]) => held[key] === undefined).map(([locale]) => ({ key, locale }));
  });
}
