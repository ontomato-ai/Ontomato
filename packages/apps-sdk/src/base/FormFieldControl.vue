<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElFormItem } from "element-plus/es/components/form/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { ElSwitch } from "element-plus/es/components/switch/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { admitsNull, valueAt } from "../panel/form-values";
import { agentAvatar, avatarIconOptions, darkAvatarColorOptions, lightAvatarColorOptions, storedAgentAvatar } from "@ontomato/agent-shell-ui/avatar";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import { useFormControls } from "./form-controls";
import FormCodeField from "./FormCodeField.vue";

/**
 * One field of an owner form, drawn by the control its owner names, at its current absolute JSON Pointer. An object's
 * fields and an array row's fields are described relative to it and drawn here again at `path + their path`, so a row's
 * messages, marks and refreshes are the form's own at the row's current index. A row keeps the identity its owner gives
 * it (`itemKeyPath`), so moving one moves its controls with it; nothing about a row is kept beside the form's values.
 *
 * The owner's value shapes are kept as they are: a cleared number is null, never 0; an untouched, omitted object stays
 * absent and a removed one is null; a select keeps a numeric choice a number.
 */
const props = withDefaults(defineProps<{ field: PanelFormField; path: string; disabled?: boolean }>(), { disabled: false });
const controls = useFormControls();
const { t } = useI18n();

const value = computed(() => valueAt(controls.values.value, props.path));
const off = computed(() => props.disabled || props.field.readOnly || controls.busy.value);
const control = computed(() => props.field.control);
const set = (next: RuntimeJsonValue) => controls.set(props.path, next);

const text = computed(() => (typeof value.value === "string" ? value.value : ""));
const rows = computed<RuntimeJsonValue[]>(() => (Array.isArray(value.value) ? value.value : []));
const object = computed(() => (value.value !== null && typeof value.value === "object" && !Array.isArray(value.value) ? value.value : null));

/** A row's identity: the owner's, when the description names where it is and the row has one; else its position. */
function rowKey(row: RuntimeJsonValue, index: number): string {
  const keyPath = control.value.kind === "object-array" ? control.value.itemKeyPath : undefined;
  const key = keyPath && row !== null && typeof row === "object" && !Array.isArray(row) ? valueAt(row, keyPath) : undefined;
  return typeof key === "string" || typeof key === "number" ? `key:${key}` : `new:${index}`;
}

function move(index: number, to: number) {
  const order = rows.value.map((_, at) => at);
  order.splice(index, 1);
  order.splice(to, 0, index);
  controls.reorder(props.path, order);
}
const remove = (index: number) => controls.reorder(props.path, rows.value.map((_, at) => at).filter((at) => at !== index));

function addRow() {
  if (control.value.kind === "object-array") set([...rows.value, control.value.defaultItem ?? {}]);
  else set([...rows.value, ""]);
}
/** A number as the reader typed it; cleared, it is null, never 0. (The input itself refuses text that is no number.) */
const setNumber = (typed: string) => set(typed === "" ? null : Number(typed));
/**
 * A local time as HH:mm (the time zone is the owner's own field). Cleared, it is null where the owner's value schema
 * admits null, and otherwise the empty text, which the owner refuses as it refuses any time it does not accept.
 */
const setTime = (typed: string) => set(typed === "" && admitsNull(props.field.valueSchema) ? null : typed);
const setString = (index: number, next: string) => set(rows.value.map((row, at) => (at === index ? next : row)));
/**
 * An avatar, as the platform's avatars are chosen and stored (an agent's `icon`): one of its icons on one of its swatches,
 * written as `{"key","color"}` text with the swatch's light value; the picker shows the current theme's swatches, which
 * correspond to the light ones by index.
 */
const isDark = useDarkMode();
const avatar = computed(() => agentAvatar(typeof value.value === "string" ? value.value : null));
const swatches = computed(() => (isDark.value ? darkAvatarColorOptions : lightAvatarColorOptions));
const chosenSwatch = computed(() => Math.max(0, lightAvatarColorOptions.indexOf(avatar.value.color)));
const setAvatar = (next: { key?: string; swatch?: number }) => set(storedAgentAvatar({
  key: next.key ?? avatar.value.key,
  color: next.swatch === undefined ? avatar.value.color : lightAvatarColorOptions[next.swatch]!,
}));
/** A hidden field is the owner's and is drawn by no control. */
const drawn = (fields: readonly PanelFormField[]) => fields.filter((child) => child.control.kind !== "hidden");
const addObject = () => set(control.value.kind === "object" ? control.value.defaultObject ?? {} : {});
</script>

<template>
  <el-form-item
    class="sdk-form-field"
    :label="field.label"
    :required="field.required"
    :error="controls.errors.value[path]"
    :class="{ 'sdk-owner-form-field-changed': controls.changed.value.has(path), 'is-readonly': field.readOnly }"
    :data-field="path"
  >
    <el-input
      v-if="control.kind === 'text' || control.kind === 'markdown'"
      :model-value="text"
      :type="control.kind === 'markdown' || control.multiline ? 'textarea' : 'text'"
      :autosize="control.kind === 'markdown' ? { minRows: 6 } : undefined"
      :placeholder="control.kind === 'text' ? control.placeholder ?? undefined : undefined"
      :maxlength="control.kind === 'text' ? control.maxLength : undefined"
      :disabled="off"
      @update:model-value="set($event)"
    ></el-input>
    <el-select
      v-else-if="control.kind === 'select'"
      :model-value="control.multiple ? rows : value ?? ''"
      :multiple="control.multiple"
      :filterable="control.allowCreate"
      :allow-create="control.allowCreate"
      :default-first-option="control.allowCreate"
      :disabled="off"
      class="sdk-form-field-wide"
      @update:model-value="set($event)"
    >
      <el-option
        v-for="option in control.options"
        :key="option.value"
        :value="option.value"
        :label="option.label"
        :disabled="option.disabled"
        :title="option.disabledReason ?? option.description ?? undefined"
      ></el-option>
    </el-select>
    <el-switch
      v-else-if="control.kind === 'switch'"
      :model-value="value === true"
      :disabled="off"
      @update:model-value="set($event === true)"
    ></el-switch>
    <el-input
      v-else-if="control.kind === 'time'"
      type="time"
      :model-value="text"
      :disabled="off"
      class="sdk-form-field-time"
      @update:model-value="setTime"
    ></el-input>
    <el-input
      v-else-if="control.kind === 'number'"
      type="number"
      :model-value="typeof value === 'number' ? String(value) : ''"
      :disabled="off"
      @update:model-value="setNumber"
    ></el-input>
    <form-code-field v-else-if="control.kind === 'code'" :field="field" :path="path" :disabled="off"></form-code-field>
    <div v-else-if="control.kind === 'string-array'" class="sdk-form-rows">
      <div v-for="(row, index) in rows" :key="index" class="sdk-form-string-row">
        <el-input :model-value="typeof row === 'string' ? row : ''" :disabled="off" @update:model-value="setString(index, $event)"></el-input>
        <el-button v-if="!off" text @click="remove(index)">{{ t("platform.formRemove") }}</el-button>
      </div>
      <el-button v-if="!off" class="sdk-form-add" @click="addRow">{{ t("platform.formAdd") }}</el-button>
    </div>
    <div v-else-if="control.kind === 'object'" class="sdk-form-object">
      <template v-if="object">
        <form-field-control
          v-for="child in drawn(control.fields)"
          :key="child.path"
          :field="child"
          :path="path + child.path"
          :disabled="off"
        ></form-field-control>
        <el-button v-if="!off && !field.required" text class="sdk-form-object-remove" @click="set(null)">
          {{ t("platform.formRemove") }}
        </el-button>
      </template>
      <el-button v-else-if="!off" class="sdk-form-add" @click="addObject">{{ t("platform.formAdd") }}</el-button>
    </div>
    <div v-else-if="control.kind === 'object-array'" class="sdk-form-rows">
      <div v-for="(row, index) in rows" :key="rowKey(row, index)" class="sdk-form-row" :data-row="path + '/' + index">
        <div class="sdk-form-row-fields">
          <template v-for="child in drawn(control.itemFields)" :key="child.path">
            <!-- A row's reference is drawn by the projection declared for it, at the row's current index. -->
            <template v-if="child.control.kind === 'reference'">
              <component
                :is="controls.rowControl(path, child.path)"
                v-if="controls.rowControl(path, child.path)"
                class="sdk-form-field"
                :path="path + '/' + index + child.path"
              ></component>
              <p v-else-if="controls.rowControl(path, child.path) === undefined" role="alert" class="sdk-form-field-unavailable">
                {{ child.label }}: {{ t("platform.formControlUnavailable") }}
              </p>
            </template>
            <form-field-control v-else :field="child" :path="path + '/' + index + child.path" :disabled="off"></form-field-control>
          </template>
        </div>
        <div v-if="!off" class="sdk-form-row-tools">
          <el-button text :disabled="index === 0" @click="move(index, index - 1)">{{ t("platform.formMoveUp") }}</el-button>
          <el-button text :disabled="index === rows.length - 1" @click="move(index, index + 1)">{{ t("platform.formMoveDown") }}</el-button>
          <el-button text @click="remove(index)">{{ t("platform.formRemove") }}</el-button>
        </div>
      </div>
      <el-button v-if="!off" class="sdk-form-add" @click="addRow">{{ t("platform.formAdd") }}</el-button>
    </div>
    <div v-else-if="control.kind === 'avatar'" class="sdk-form-avatar">
      <div class="sdk-form-avatar-choices" role="group" :aria-label="t('platform.formAvatarIcon')">
        <button
          v-for="option in avatarIconOptions"
          :key="option.key"
          type="button"
          class="sdk-form-avatar-icon"
          :class="{ active: avatar.key === option.key }"
          :title="option.key"
          :aria-label="option.key"
          :aria-pressed="avatar.key === option.key"
          :disabled="off"
          @click="setAvatar({ key: option.key })"
        >
          <component :is="option.icon" :size="18" aria-hidden="true"></component>
        </button>
      </div>
      <div class="sdk-form-avatar-choices" role="group" :aria-label="t('platform.formAvatarColor')">
        <button
          v-for="(color, index) in swatches"
          :key="index"
          type="button"
          class="sdk-form-avatar-color"
          :class="{ active: chosenSwatch === index }"
          :style="{ background: color }"
          :aria-label="t('platform.formAvatarColorOption', { index: index + 1 })"
          :aria-pressed="chosenSwatch === index"
          :disabled="off"
          @click="setAvatar({ swatch: index })"
        ></button>
      </div>
    </div>
    <p v-else role="alert" class="sdk-form-field-unavailable">{{ t("platform.formControlUnavailable") }}</p>
    <p v-if="field.readOnly && field.readOnlyReason && !controls.sharedReadOnlyReasons.value.has(field.readOnlyReason)" class="sdk-form-field-help">{{ field.readOnlyReason }}</p>
    <p v-else-if="field.help" class="sdk-form-field-help">{{ field.help }}</p>
  </el-form-item>
</template>

<style scoped>
/* A value the owner keeps read-only is still the reader's to read: Element Plus's disabled grey is for a control that is
   off, not for a value that is shown. */
.sdk-form-field.is-readonly :deep(:is(.el-input__inner, .el-textarea__inner, .el-select__selected-item)) {
  color: var(--el-text-color-regular);
  -webkit-text-fill-color: var(--el-text-color-regular);
}
.sdk-form-avatar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-form-avatar-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-form-avatar-icon,
.sdk-form-avatar-color {
  align-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: inline-flex;
  height: var(--control-height);
  justify-content: center;
  width: var(--control-height);
}
.sdk-form-avatar-icon {
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}
.sdk-form-avatar-icon.active,
.sdk-form-avatar-color.active {
  border-color: var(--brand-link);
  box-shadow: 0 0 0 1px var(--brand-link);
}
.sdk-form-avatar-icon:disabled,
.sdk-form-avatar-color:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.sdk-form-field-wide {
  width: 100%;
}
.sdk-owner-form-field-changed > :deep(.el-form-item__label) {
  color: var(--brand-link);
}
.sdk-form-field-help {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: var(--spacing-xs) 0 0;
}
.sdk-form-field-time {
  width: 160px;
}
.sdk-form-field-unavailable {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: 0;
}
.sdk-form-rows,
.sdk-form-object {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
}
.sdk-form-string-row {
  display: flex;
  gap: var(--spacing-sm);
}
.sdk-form-row {
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
}
.sdk-form-row-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--spacing-md);
}
.sdk-form-row-fields > .sdk-form-field {
  flex: 1 1 160px;
  min-width: 0;
}
.sdk-form-row-tools {
  display: flex;
  justify-content: flex-end;
}
.sdk-form-add,
.sdk-form-object-remove {
  align-self: flex-start;
}
</style>
