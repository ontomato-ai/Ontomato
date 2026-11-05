/**
 * The page's text arrives resolved: the host owns one vue-i18n instance for the whole page, merges this package's
 * dictionaries (`./locales/en`, `./locales/zh`) under `platformSchedules`, and hands the list a `Translate` that reads
 * that key. The components therefore never import vue-i18n themselves and read the same language as the shell around
 * them.
 */
export type Translate = (key: string, named?: Record<string, unknown>, count?: number) => string;
