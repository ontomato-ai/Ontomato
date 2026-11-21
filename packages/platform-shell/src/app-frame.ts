import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";

/*
 * Whether the application shown now draws its own frame (product-layer standard, part one; design §三): an application
 * that names a frame panel has that panel in its area instead of the platform's application menu, and the entry's page
 * header is drawn inside the frame, where its content is. The frame that draws the platform's layout then leaves the
 * area to it — no menu column, no header, no gutter of its own; the rail and the account area stay the platform's.
 */

const applicationFrameKey: InjectionKey<Ref<boolean>> = Symbol("platform-application-frame");

/** Called by the frame that draws the platform's layout: true while the shown application draws its own frame. */
export function provideApplicationFrame(): Readonly<Ref<boolean>> {
  const framed = shallowRef(false);
  provide(applicationFrameKey, framed);
  return framed;
}

/** Tells the platform's layout whether the calling page's application draws its own frame, until the page goes. */
export function useApplicationFrame(framed: () => boolean) {
  const target = inject(applicationFrameKey, null);
  if (!target) return;
  watch(framed, (value) => { target.value = value; }, { immediate: true });
  onBeforeUnmount(() => { target.value = false; });
}
