import { PAGE_DRAFT_QUERY_KEYS, pageDraftLink, pageDraftLinkSchema } from "@ontomato/contracts/page-draft";

/** Ordinary links return undefined. Invalid draft destinations return null instead of opening externally. */
export function absoluteDraftAddress(href: string): string | null | undefined {
  if (!/^(?:https?:\/\/|\/\/)/iu.test(href)) return undefined;
  let url: URL;
  try {
    url = new URL(href.startsWith("//") ? "https:" + href : href);
  } catch {
    return undefined;
  }

  const addresses = [url.pathname + url.search + url.hash];
  if (url.hash.startsWith("#/")) addresses.unshift(url.hash.slice(1));
  for (const address of addresses) {
    const query = address.split("#", 1)[0]!;
    const start = query.indexOf("?");
    if (start < 0) continue;
    const params = new URLSearchParams(query.slice(start + 1));
    if (!PAGE_DRAFT_QUERY_KEYS.every(key => params.has(key))) continue;
    const link = pageDraftLink(Object.fromEntries(params));
    return /^\/(?!\/)[^\\\s\p{Cc}]*$/u.test(address) &&
      PAGE_DRAFT_QUERY_KEYS.every(key => params.getAll(key).length === 1) &&
      pageDraftLinkSchema.safeParse(link).success ? address : null;
  }
  return undefined;
}
