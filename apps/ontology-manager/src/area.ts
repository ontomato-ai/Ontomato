import { defineComponent, h, type PropType } from "vue";
import { ElButton } from "element-plus";
import { PLATFORM_ROOT } from "@ontomato/platform-admin";

/*
 * The Ontology Manager page hosts two areas: the Manager workspace (its own hash view) and the platform area (one
 * vue-router over the platform pages). Each page load starts exactly one of them from the hash, so only one router owns
 * the hash; moving between them reloads the page.
 */

/**
 * Reloads the page when the hash moves to a different area than the one this load started; `classify` returns the area
 * (and, for editions with sign-in, the kind of page) a hash belongs to.
 */
export function reloadOnAreaChange(classify: (hash: string) => string) {
  const started = classify(window.location.hash);
  window.addEventListener("hashchange", () => {
    if (classify(window.location.hash) !== started) window.location.reload();
  });
}

/** Leaves the platform area for the workspace's initial view; the area change reloads the page. */
export function openWorkspace() {
  window.location.hash = "#/";
}

/** The workspace header's entry into the platform area; the host decides whether the account may see it. */
export const PlatformEntryLink = defineComponent({
  name: "PlatformEntryLink",
  props: {
    label: { type: Function as PropType<() => string>, required: true },
  },
  setup(props) {
    return () =>
      h(ElButton, { class: "manager-platform-entry", tag: "a", href: `#${PLATFORM_ROOT}`, text: true, size: "small" }, () =>
        props.label()
      );
  },
});
