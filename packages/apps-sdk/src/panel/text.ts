import { watch, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import type { PanelMessages } from "@ontomato/contracts/product-panels";

/*
 * A panel's own words (design 7.1): the titles and messages its HTML lays out, kept with the panel's content as one text
 * per key and locale. They are the panel's; the SDK's own controls carry the SDK's words, and an object's, a field's or
 * an operation's name is its owner's. A panel reads its words through `t(key, params)` in the platform's current
 * language, by the platform's own rule: the current language, else the deployment's default language, else the key as
 * it is — never another language in between. There is no second negotiation of the language: the language is the one
 * the platform hands the frame and follows while the panel is open.
 */

/** Reads one of the panel's words in the current language, with the values its text names. */
export type PanelText = (key: string, params?: Readonly<Record<string, unknown>>) => string;

/**
 * The panel's `t`: its words in `locale`, which follows the platform, falling back to `defaultLocale` and then to the key.
 * A template that calls it draws again when the language changes.
 */
export function createPanelText(messages: PanelMessages, locale: Readonly<Ref<string>>, defaultLocale: string): PanelText {
  const i18n = createI18n({
    legacy: false,
    locale: locale.value,
    fallbackLocale: defaultLocale,
    // A key is the panel's own name for a text, dots and all; it is not a path into nested messages.
    flatJson: true,
    messages,
    // A missing word shows its key, as the platform's do; the panel's author sees it there, not in the console.
    missingWarn: false,
    fallbackWarn: false,
  });
  watch(locale, (next) => {
    i18n.global.locale.value = next;
  }, { flush: "sync" });
  return (key, params) => i18n.global.t(key, { ...params });
}
