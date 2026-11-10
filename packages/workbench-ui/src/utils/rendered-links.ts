import { withPptDownloadCredentials } from "./ppt-links";

/**
 * The link rules of every rendered Markdown answer. PPT downloads get the caller's credentials, and every link
 * except an in-page anchor opens in a new tab: a source or download link must not navigate the conversation away.
 */
export function withRenderedLinks(html: string): string {
  return withPptDownloadCredentials(html).replace(/<a href="(?!#)/g, '<a target="_blank" rel="noopener noreferrer" href="');
}
