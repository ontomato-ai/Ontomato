<script setup lang="ts">
import {
  computed,
  effectScope,
  onBeforeUnmount,
  onErrorCaptured,
  provide,
  ref,
  shallowRef,
  watch,
  type Component,
  type EffectScope,
} from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelRecordItemKey } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { DataState } from "@ontomato/foundation-ui/data-state";
import { projectionKey, usePanelContext } from "../panel/context";
import {
  PanelMemberUnavailable,
  type DirectPanelInstance,
  type MemberData,
  type MemberInputs,
} from "../panel/direct";
import { panelMemberKey, type MemberParam, type PanelMemberContext, type PanelMemberRowOperation } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import {
  assertNoBoundParamOverride,
  buildRowMemberPath,
  buildRowOperationContext,
  resolveRowMemberInputs,
} from "../panel/row-member";
import { useDataStateLabels } from "./data-state-labels";

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='radio']",
  "[role='menuitem']",
  "[role='combobox']",
  "[role='tab']",
  "[contenteditable='true']",
].join(", ");

const props = defineProps<{
  /** Member key declared in `manifest.members` with `listColumn` or `listRowDetail`. */
  memberKey: string;
  /** Which host slot renders this row instance. */
  kind: "listColumn" | "listRowDetail";
  /** Current row record from the host `ObjectList` (never exposed whole to the mounted component). */
  row: PlatformObjectRecord;
  /** Host list fallback object type used when resolving `{ item: true }` on homogeneous rows. */
  fallbackClassName?: string;
  /** Actual `runtimeParams` used by the host `ObjectList` read (forwarded in `rowContext` for row operations). */
  hostRuntimeParams: Readonly<Record<string, RuntimeJsonValue>>;
}>();

const { t } = useI18n();
const panel = usePanelContext();
const directInstance = "memberDefinition" in panel.instance ? (panel.instance as DirectPanelInstance) : null;
const host = ref<HTMLElement | null>(null);
const failure = shallowRef<Error | null>(null);
const loaded = shallowRef<{ component: Component; projection: DirectProjection; member: PanelMemberContext } | null>(null);

if (directInstance) {
  const declaration = directInstance.direct.members[props.memberKey];
  if (declaration?.theme) {
    let disposed = false;
    let stopTheme: (() => void) | undefined;
    onBeforeUnmount(() => {
      disposed = true;
      stopTheme?.();
    });
    void Promise.all([
      import("@ontomato/foundation-ui/theme"),
      import("@ontomato/platform-shell"),
    ]).then(([{ useDarkMode }, { applyTheme }]) => {
      if (disposed || !host.value) return;
      const dark = useDarkMode();
      stopTheme = applyTheme(host.value, () => declaration.theme, () => (dark.value ? "dark" : "light"));
    });
  }
}

onErrorCaptured((reason: unknown) => {
  failure.value ??= reason instanceof Error ? reason : new Error(String(reason));
  return false;
});

function forbiddenListColumnData(memberKey: string): MemberData {
  const fail = (): never => {
    throw new Error(`listColumn member '${memberKey}' cannot initiate independent data reads`);
  };
  return { use: fail, read: fail };
}

let rowScope: EffectScope | null = null;
let loadGeneration = 0;

function stopRowScope() {
  rowScope?.stop();
  rowScope = null;
}

onBeforeUnmount(() => {
  loadGeneration += 1;
  stopRowScope();
});

watch(
  () => [props.memberKey, directInstance ? directInstance.projectionVersion(props.memberKey) : 0] as const,
  ([memberKey]) => {
    const generation = ++loadGeneration;
    stopRowScope();
    loaded.value = null;
    failure.value = null;

    if (!directInstance) {
      failure.value = new Error(`Host-mounted member '${memberKey}' requires a directly rendered panel instance`);
      return;
    }
    const declaration = directInstance.direct.members[memberKey];
    if (!declaration) {
      failure.value = new Error(`The panel declares no member '${memberKey}'`);
      return;
    }

    void directInstance.memberDefinition(memberKey).then(({ projection, component }) => {
      if (generation !== loadGeneration) return;
      if (props.kind === "listColumn" && Object.keys(projection.data).length > 0) {
        throw new Error(`listColumn member '${memberKey}' cannot declare independent data reads`);
      }

      const scope = effectScope();
      const member = scope.run<PanelMemberContext>(() => {
        const inputs = computed<MemberInputs>(() =>
          resolveRowMemberInputs(
            projection,
            declaration,
            directInstance.state.values.value,
            props.row,
            props.fallbackClassName,
          ),
        );
        const localOwnParams = shallowRef<Record<string, RuntimeJsonValue>>({});
        const param = (name: string): MemberParam => {
          if (declaration.inputs && Object.hasOwn(declaration.inputs, name)) {
            return {
              value: computed(() => inputs.value[name] ?? null),
              set: () => {
                throw new Error(`Row member '${memberKey}' fixes '${name}'; it cannot be set`);
              },
            };
          }
          return {
            value: computed(() => localOwnParams.value[name] ?? null),
            set(value) {
              const next = { ...localOwnParams.value };
              if (value === null) delete next[name];
              else next[name] = value;
              localOwnParams.value = next;
            },
          };
        };

        const data: MemberData = props.kind === "listColumn"
          ? forbiddenListColumnData(memberKey)
          : directInstance.memberData(memberKey, projection, () => inputs.value, () => localOwnParams.value);
        const operations = directInstance.rowMemberOperations(memberKey, projection, () => inputs.value);
        const rowOperation: PanelMemberRowOperation = {
          async run(operationName, callerInput) {
            const sanitizedInput = assertNoBoundParamOverride(projection, operationName, callerInput);
            const itemKey = panelRecordItemKey(props.row);
            const memberPath = buildRowMemberPath(directInstance.memberPathOf(memberKey), itemKey);
            const operationId = directInstance.operationIdOf(memberKey, operationName);
            const rowContext = buildRowOperationContext(
              directInstance,
              props.hostRuntimeParams,
              directInstance.frameState(),
            );
            return directInstance.writeOperation(
              operationId,
              { call: { input: sanitizedInput } },
              { memberPath, rowContext },
            );
          },
        };

        return {
          key: memberKey,
          projection,
          inputs,
          data,
          operations,
          param,
          rowOperation,
        };
      })!;

      rowScope = scope;
      loaded.value = { component, projection, member };
    }).catch((reason: unknown) => {
      if (generation !== loadGeneration) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
    });
  },
  { immediate: true },
);

const refused = computed(() => {
  const reason = failure.value;
  if (!reason) return null;
  if (reason instanceof PanelMemberUnavailable) {
    return reason.status === 403
      ? { status: "forbidden" as const }
      : { status: "error" as const, message: t("platform.memberUnavailable") };
  }
  return { status: "error" as const, message: reason.message };
});

provide(projectionKey, {
  get slot() {
    return props.memberKey;
  },
  get projection() {
    return loaded.value!.projection;
  },
  get inputs() {
    return loaded.value!.member.inputs.value;
  },
});
provide(panelMemberKey, () => loaded.value!.member);

const bound = computed(() => {
  const current = loaded.value;
  if (!current) return {};
  const options = current.component as { props?: readonly string[] | Record<string, unknown> };
  const declared = new Set(Array.isArray(options.props) ? options.props : Object.keys(options.props ?? {}));
  return Object.fromEntries(
    Object.entries({ ...current.projection.config, ...current.member.inputs.value }).filter(([name]) => declared.has(name)),
  );
});

const labels = useDataStateLabels();

function isInsideInteractiveControl(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!(target instanceof Element) || !container) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return Boolean(interactive && container.contains(interactive));
}

function onHostClick(event: MouseEvent) {
  if (props.kind === "listRowDetail") {
    event.stopPropagation();
    return;
  }
  if (isInsideInteractiveControl(event.target, event.currentTarget as HTMLElement | null)) {
    event.stopPropagation();
  }
}

function onHostKeydown(event: KeyboardEvent) {
  if (props.kind === "listRowDetail") return;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  if (isInsideInteractiveControl(event.target, event.currentTarget as HTMLElement | null)) {
    event.stopPropagation();
  }
}
</script>

<template>
  <div
    ref="host"
    :class="kind === 'listColumn' ? 'sdk-object-list-cell-host' : 'sdk-object-list-detail-host'"
    :data-list-member="memberKey"
    @click="onHostClick"
    @keydown="onHostKeydown"
  >
    <data-state v-if="refused" :result="refused" :labels="labels"></data-state>
    <template v-else-if="!loaded">
      <data-state v-if="kind === 'listRowDetail'" :result="{ status: 'loading' }" :labels="labels"></data-state>
      <span v-else class="sdk-object-list-cell-loading" aria-busy="true"></span>
    </template>
    <component :is="loaded.component" v-else v-bind="bound"></component>
  </div>
</template>

<style scoped>
.sdk-object-list-cell-host {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
}
.sdk-object-list-detail-host {
  width: 100%;
}
.sdk-object-list-cell-loading {
  display: inline-block;
  min-width: 1em;
}
</style>
