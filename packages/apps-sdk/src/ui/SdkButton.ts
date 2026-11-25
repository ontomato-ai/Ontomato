import { defineComponent, h, type Component, type PropType } from "vue";
import { ElButton } from "element-plus/es/components/button/index";
import { appIcon, hasAppIcon } from "@ontomato/platform-shell";

function normalizeIconName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function resolveButtonIcon(icon: string | Component | undefined): string | Component | undefined {
  if (typeof icon !== "string") return icon;
  const trimmed = icon.trim();
  if (!trimmed) return undefined;
  if (hasAppIcon(trimmed)) return appIcon(trimmed);
  const kebab = normalizeIconName(trimmed);
  if (hasAppIcon(kebab)) return appIcon(kebab);
  return icon;
}

/**
 * SDK-wrapped `<sdk-button>` primitive over `ElButton` that resolves curated platform icon names
 * (such as `"refresh-cw"`, `"RefreshCw"`, `"plug"`, `"pencil"`, `"trash-2"`) into Lucide icon components
 * while forwarding every other prop, attribute, event, and slot transparently.
 */
export const SdkButton = defineComponent({
  name: "SdkButton",
  inheritAttrs: false,
  props: {
    icon: {
      type: [String, Object, Function] as PropType<string | Component>,
      default: undefined,
    },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const resolvedIcon = resolveButtonIcon(props.icon);
      return h(
        ElButton,
        resolvedIcon === undefined ? attrs : { ...attrs, icon: resolvedIcon },
        slots,
      );
    };
  },
});
