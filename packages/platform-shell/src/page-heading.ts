import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";

/**
 * What a page shown under the platform's frame says of itself when the platform's navigation does not name it: its
 * title, and its way back when the reader reached it from elsewhere (big main's ruling, 2026-11-21: a panel draws neither;
 * the platform draws both from its entry).
 */
export interface PlatformPageHeading {
  title: string;
  /** Present for a page the application's menu does not reach. */
  back?: () => void;
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
