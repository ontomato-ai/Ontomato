import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";

/**
 * What a page shown under the platform's frame says of itself when the platform's navigation does not name it: its
 * title, and its way back when the reader reached it from elsewhere (big main's ruling, 2026-11-21: a panel draws neither;
 * the platform draws both from its entry).
 */
export interface PlatformPageHeading {
  title: string;
  /** The line under the title, as a native page's header has it: the entry's description in the reader's language. */
  description?: string;
  /** Present for a page the application's menu does not reach, or a full-width detail view returning to its catalog. */
  back?: () => void;
  /** Optional custom label for the header's back control (for example "Back to relation types"). */
  backLabel?: string;
  /**
   * The entry's external link: its address with the state it is at, opened without the platform's rail. The header
   * offers to copy it; absent for a page that is no entry of an application.
   */
  externalLink?: string;
}

const pageHeadingKey: InjectionKey<Ref<PlatformPageHeading | null>> = Symbol("platform-page-heading");

/** Called by the frame that draws the header: the shown page writes its heading here. */
export function providePageHeading(): Readonly<Ref<PlatformPageHeading | null>> {
  const heading = shallowRef<PlatformPageHeading | null>(null);
  provide(pageHeadingKey, heading);
  return heading;
}

/**
 * Shows the calling page's heading in its frame's header while the page offers one, and clears what it showed when it
 * stops offering it or unmounts. A page mounted outside a frame that draws a header has nowhere to show it.
 */
export function usePageHeading(heading: () => PlatformPageHeading | null) {
  const target = inject(pageHeadingKey, null);
  if (!target) return;
  let shown: PlatformPageHeading | null = null;
  const clear = () => {
    if (shown && target.value === shown) target.value = null;
    shown = null;
  };
  watch(heading, (next) => {
    if (next) target.value = shown = next;
    else clear();
  }, { immediate: true });
  onBeforeUnmount(clear);
}
