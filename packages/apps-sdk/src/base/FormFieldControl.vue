<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch, type Slot } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElInputNumber } from "element-plus/es/components/input-number/index";
import { ElSwitch } from "element-plus/es/components/switch/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  panelFormObjectActiveFields,
  panelFormObjectActiveVariant,
  type PanelFormField,
} from "@ontomato/contracts/panel-projection";
import { admitsNull, cloneJsonValue, valueAt } from "../panel/form-values";
import { agentAvatar, avatarIconOptions, darkAvatarColorOptions, lightAvatarColorOptions, storedAgentAvatar } from "@ontomato/agent-shell-ui/avatar";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import { useFormControls } from "./form-controls";
import FormCodeField from "./FormCodeField.vue";
import FormLocalizedText from "./FormLocalizedText.vue";
import FormAdvancedSection from "./FormAdvancedSection.vue";
import FormFieldFrame from "./FormFieldFrame.vue";
import FormRowField from "./FormRowField.vue";
import FormSelectChoices from "./FormSelectChoices.vue";
import FormChoiceMatrix from "./FormChoiceMatrix.vue";
import FormTextVariables from "./FormTextVariables.vue";
import { ApplicationIconPicker, appIcon } from "@ontomato/platform-shell";
import { ScheduleFrequency, frequencyDraft, frequencyOf, type FrequencyDraft } from "@ontomato/platform-schedules/frequency-control";
import type { PlatformTaskFrequency } from "@ontomato/contracts/platform-schedules";

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
const { t, locale } = useI18n();

const value = computed(() => valueAt(controls.values.value, props.path));
const off = computed(() => props.disabled || props.field.readOnly || controls.busy.value);
const control = computed(() => props.field.control);
const set = (next: RuntimeJsonValue) => controls.set(props.path, next);
const text = computed(() => (typeof value.value === "string" ? value.value : ""));
const rows = computed<RuntimeJsonValue[]>(() => (Array.isArray(value.value) ? value.value : []));
const object = computed(() => (value.value !== null && typeof value.value === "object" && !Array.isArray(value.value) ? value.value : null));

const textInput = useTemplateRef<InstanceType<typeof ElInput>>("textInput");

async function insertVariable(token: string) {
  if (off.value) return;
  const editor = (textInput.value!.textarea ?? textInput.value!.input)!;
  const focused = editor.ownerDocument.activeElement === editor;
  const current = focused ? editor.value : text.value;
  const start = focused ? editor.selectionStart! : current.length;
  const end = focused ? editor.selectionEnd! : start;
  set(current.slice(0, start) + token + current.slice(end));
  await nextTick();
  editor.focus();
  editor.setSelectionRange(start + token.length, start + token.length);
}

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
  if (control.value.kind === "object-array") set([...rows.value, cloneJsonValue(control.value.defaultItem ?? {})]);
  else set([...rows.value, ""]);
}
/** A number as the reader typed it; cleared, it is null, never 0. (The input itself refuses text that is no number.) */
const setNumber = (typed: string) => set(typed === "" ? null : Number(typed));
const setStepperNumber = (next: number | null | undefined) => set(typeof next === "number" && Number.isFinite(next) ? next : null);
const trashIcon = appIcon("trash-2");
const RenderArrayItemFooter = (footerProps: { render: Slot; scope: Record<string, unknown> }) =>
  footerProps.render(footerProps.scope);
function arrayItemFooter(row: RuntimeJsonValue, index: number) {
  return controls.resolveArrayItemFooterSlot?.(
    props.path,
    row,
    index,
    rowKey(row, index),
    off.value,
    props.field.readOnly,
  );
}
const arrayPresentation = computed(() => (control.value.kind === "object-array" ? (control.value.presentation ?? "cards") : "cards"));
const arrayFixedRows = computed(() => control.value.kind === "object-array" && control.value.fixedRows === true);
const arrayReorderable = computed(() => {
  if (control.value.kind !== "object-array" || arrayFixedRows.value) return false;
  if (control.value.reorderable !== undefined) return control.value.reorderable;
  return arrayPresentation.value === "cards";
});
const arrayVisibleColumns = computed(() => (
  control.value.kind === "object-array" ? drawn(control.value.itemFields, false) : []
));
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
/** A hidden field is the owner's and is drawn by no control; an advanced one is drawn in the level's advanced section. */
const drawn = (fields: readonly PanelFormField[], advanced: boolean) =>
  fields.filter((child) => child.control.kind !== "hidden" && (child.advanced === true) === advanced);
const objectVariant = computed(() => (
  control.value.kind === "object"
    ? panelFormObjectActiveVariant(control.value, object.value ?? undefined)
    : undefined
));
const objectFields = computed(() => (
  control.value.kind === "object"
    ? panelFormObjectActiveFields(control.value, object.value ?? undefined)
    : []
));
const commonObjectPaths = computed(() => new Set(
  control.value.kind === "object" ? control.value.fields.map((child) => child.path) : [],
));
const objectChildKey = (child: PanelFormField) => (
  commonObjectPaths.value.has(child.path) || objectVariant.value === undefined
    ? child.path
    : `${objectVariant.value}:${child.path}`
);
const addObject = () => set(control.value.kind === "object" ? cloneJsonValue(control.value.defaultObject ?? {}) : {});
/**
 * A frequency, edited as the scheduled task page edits it: the editor keeps every kind's own values while the reader
 * switches kinds, and the owner's value is the chosen kind's alone. A new value from the owner (a draft, a refresh)
 * starts the editor again from it.
 */
const frequency = shallowRef<FrequencyDraft>(frequencyDraft());
watch(value, (next) => {
  if (control.value.kind !== "frequency") return;
  const owned = next as PlatformTaskFrequency | null | undefined;
  if (JSON.stringify(owned ?? null) !== JSON.stringify(frequencyOf(frequency.value)))
    frequency.value = frequencyDraft(owned ?? undefined);
}, { immediate: true });
function setFrequency(next: FrequencyDraft) {
  frequency.value = next;
  set(frequencyOf(next) as unknown as RuntimeJsonValue);
}
</script>

<template>
  <form-field-frame
    :field="field"
    :path="path"
    :error="controls.errors.value[path]"
    :changed="controls.changed.value.has(path)"
    :disabled="disabled"
    :field-class="controls.changed.value.has(path) ? 'sdk-form-field sdk-owner-form-field-changed' : 'sdk-form-field'"
  >
    <template v-if="control.kind === 'text' || control.kind === 'markdown'">
      <el-input
        ref="textInput"
        :model-value="text"
        :type="control.kind === 'markdown' || control.multiline ? 'textarea' : (control.kind === 'text' && control.secret ? 'password' : 'text')"
        :show-password="control.kind === 'text' && control.secret === true && !control.multiline"
        :clearable="control.kind === 'text' && control.clearable === true && !control.multiline && !off"
        :rows="control.kind === 'text' && control.multiline && !control.rows ? 3 : undefined"
        :autosize="control.kind === 'markdown' ? { minRows: 6 } : (control.kind === 'text' && control.multiline && control.rows ? { minRows: control.rows, maxRows: Math.max(control.rows, 24) } : undefined)"
        :placeholder="control.kind === 'text' ? control.placeholder ?? undefined : undefined"
        :maxlength="control.kind === 'text' ? control.maxLength : undefined"
        :show-word-limit="control.kind === 'text' && control.maxLength !== undefined && !off"
        :disabled="off"
        @update:model-value="set($event)"
      ></el-input>
      <form-text-variables
        v-if="control.kind === 'text' && control.variables?.length"
        :groups="control.variables"
        :disabled="off"
        :collapsible="control.variablesCollapsible"
        :presentation="control.variablesPresentation"
        @insert="insertVariable"
      ></form-text-variables>
      <!-- Markdown says how long it is as the reader writes it, as the agent settings page did for its prompt. -->
      <p v-if="control.kind === 'markdown'" class="sdk-form-field-count">{{ t("platform.formCharacters", { count: text.length }) }} · Markdown</p>
    </template>
    <form-select-choices
      v-else-if="control.kind === 'select'"
      :control="control"
      :value="value"
      :label="field.label"
      :required="field.required"
      :disabled="off"
      @change="set"
      @clear="controls.remove(path)"
    ></form-select-choices>
    <form-choice-matrix
      v-else-if="control.kind === 'choice-matrix'"
      :control="control"
      :value="object ?? {}"
      :disabled="off"
      @change="set"
    ></form-choice-matrix>
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
    <el-input-number
      v-else-if="control.kind === 'number' && control.presentation === 'stepper'"
      :model-value="typeof value === 'number' ? value : undefined"
      :min="control.min"
      :max="control.max"
      :step="control.step"
      :precision="control.precision"
      :disabled="off"
      class="sdk-form-field-number-stepper"
      @update:model-value="setStepperNumber"
    ></el-input-number>
    <el-input
      v-else-if="control.kind === 'number'"
      type="number"
      :model-value="typeof value === 'number' ? String(value) : ''"
      :min="control.min"
      :max="control.max"
      :step="control.step"
      :disabled="off"
      @update:model-value="setNumber"
    ></el-input>
    <form-code-field v-else-if="control.kind === 'code'" :field="field" :path="path" :disabled="off"></form-code-field>
    <form-localized-text v-else-if="control.kind === 'localized-text'" :field="field" :path="path" :disabled="off"></form-localized-text>
    <application-icon-picker
      v-else-if="control.kind === 'application-icon'"
      :model-value="text"
      :locale="locale"
      :disabled="off"
      :heading="false"
      class="sdk-form-field-wide"
      @update:model-value="set($event)"
    ></application-icon-picker>
    <schedule-frequency
      v-else-if="control.kind === 'frequency'"
      :model-value="frequency"
      :disabled="off"
      @update:model-value="setFrequency"
    ></schedule-frequency>
    <div v-else-if="control.kind === 'string-array'" class="sdk-form-rows">
      <div v-for="(row, index) in rows" :key="index" class="sdk-form-string-row">
        <el-input :model-value="typeof row === 'string' ? row : ''" :disabled="off" @update:model-value="setString(index, $event)"></el-input>
        <el-button v-if="!off" text @click="remove(index)">{{ t("platform.formRemove") }}</el-button>
      </div>
      <el-button v-if="!off" class="sdk-form-add" @click="addRow">{{ t("platform.formAdd") }}</el-button>
    </div>
    <div
      v-else-if="control.kind === 'object'"
      class="sdk-form-object"
      :class="{
        'is-two-col': control.columns === 2,
        'is-multi-col': (control.columns ?? 1) > 1,
        'is-panel': control.presentation === 'panel',
      }"
      :style="(control.columns ?? 1) > 1 ? { '--sdk-form-cols': String(control.columns) } : undefined"
    >
      <template v-if="object">
        <form-field-control
          v-for="child in drawn(objectFields, false)"
          :key="objectChildKey(child)"
          :field="child"
          :path="path + child.path"
          :disabled="off"
        ></form-field-control>
        <form-advanced-section
          v-if="drawn(objectFields, true).length"
          class="sdk-form-object sdk-form-object-advanced"
          :class="{
            'is-two-col': control.columns === 2,
            'is-multi-col': (control.columns ?? 1) > 1,
          }"
          :style="(control.columns ?? 1) > 1 ? { '--sdk-form-cols': String(control.columns) } : undefined"
          :paths="drawn(objectFields, true).map((child) => path + child.path)"
        >
          <form-field-control
            v-for="child in drawn(objectFields, true)"
            :key="objectChildKey(child)"
            :field="child"
            :path="path + child.path"
            :disabled="off"
          ></form-field-control>
        </form-advanced-section>
        <el-button v-if="!off && !field.required" text class="sdk-form-object-remove" @click="set(null)">
          {{ t("platform.formRemove") }}
        </el-button>
      </template>
      <el-button v-else-if="!off" class="sdk-form-add" @click="addObject">{{ t("platform.formAdd") }}</el-button>
    </div>
    <div v-else-if="control.kind === 'object-array' && arrayPresentation === 'inline'" class="sdk-form-rows sdk-form-inline-rows">
      <p v-if="!rows.length && control.emptyText" class="sdk-form-array-empty">{{ control.emptyText }}</p>
      <div
        v-for="(row, index) in rows"
        :key="rowKey(row, index)"
        class="sdk-form-inline-row"
        :class="{ 'has-remove': !off && !arrayFixedRows }"
        :style="{ '--sdk-inline-cols': String(Math.max(1, arrayVisibleColumns.length)) }"
        :data-row="path + '/' + index"
      >
        <form-row-field
          v-for="child in arrayVisibleColumns"
          :key="child.path"
          :field="child"
          :path="path"
          :index="index"
          :disabled="off"
        ></form-row-field>
        <el-button
          v-if="!off && !arrayFixedRows"
          text
          type="danger"
          class="sdk-form-inline-remove"
          :aria-label="t('platform.formRemove')"
          :title="t('platform.formRemove')"
          @click="remove(index)"
        >
          <component :is="trashIcon" :size="15" aria-hidden="true" />
        </el-button>
      </div>
      <el-button
        v-if="!off && !arrayFixedRows"
        type="primary"
        link
        class="sdk-form-add sdk-form-add-inline"
        @click="addRow"
      >
        + {{ control.addLabel ?? t("platform.formAdd") }}
      </el-button>
    </div>
    <div v-else-if="control.kind === 'object-array' && arrayPresentation === 'table'" class="sdk-form-table-wrap">
      <table v-if="rows.length || !control.emptyText" class="sdk-form-table">
        <thead>
          <tr>
            <th v-for="col in arrayVisibleColumns" :key="col.path" scope="col">{{ col.label }}</th>
            <th v-if="!off && !arrayFixedRows" scope="col" class="sdk-form-table-actions-head"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="rowKey(row, index)" :data-row="path + '/' + index">
            <td v-for="col in arrayVisibleColumns" :key="col.path">
              <form-row-field
                :field="col"
                :path="path"
                :index="index"
                :disabled="off"
              ></form-row-field>
            </td>
            <td v-if="!off && !arrayFixedRows" class="sdk-form-table-actions-cell">
              <el-button
                text
                type="danger"
                size="small"
                :aria-label="t('platform.formRemove')"
                @click="remove(index)"
              >
                <component :is="trashIcon" :size="14" aria-hidden="true" />
              </el-button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="sdk-form-array-empty">{{ control.emptyText }}</p>
      <el-button v-if="!off && !arrayFixedRows" class="sdk-form-add" @click="addRow">{{ control.addLabel ?? t("platform.formAdd") }}</el-button>
    </div>
    <div v-else-if="control.kind === 'object-array'" class="sdk-form-rows">
      <p v-if="!rows.length && control.emptyText" class="sdk-form-array-empty">{{ control.emptyText }}</p>
      <div
        v-for="(row, index) in rows"
        :key="rowKey(row, index)"
        class="sdk-form-row"
        :class="{ 'is-numbered': control.numbered }"
        :data-row="path + '/' + index"
      >
        <div v-if="control.numbered" class="sdk-form-row-header">
          <span class="sdk-form-row-index">#{{ index + 1 }}</span>
          <div v-if="!off && !arrayFixedRows" class="sdk-form-row-tools">
            <template v-if="arrayReorderable">
              <el-button text size="small" :disabled="index === 0" @click="move(index, index - 1)">{{ t("platform.formMoveUp") }}</el-button>
              <el-button text size="small" :disabled="index === rows.length - 1" @click="move(index, index + 1)">{{ t("platform.formMoveDown") }}</el-button>
            </template>
            <el-button text size="small" type="danger" @click="remove(index)">{{ t("platform.formRemove") }}</el-button>
          </div>
        </div>
        <div
          class="sdk-form-row-fields"
          :class="{
            'is-two-col': control.columns === 2,
            'is-multi-col': (control.columns ?? 1) > 1,
          }"
          :style="(control.columns ?? 1) > 1 ? { '--sdk-form-cols': String(control.columns) } : undefined"
        >
          <form-row-field
            v-for="child in drawn(control.itemFields, false)"
            :key="child.path"
            :field="child"
            :path="path"
            :index="index"
            :disabled="off"
          ></form-row-field>
          <form-advanced-section
            v-if="drawn(control.itemFields, true).length"
            class="sdk-form-row-fields sdk-form-row-advanced"
            :class="{
              'is-two-col': control.columns === 2,
              'is-multi-col': (control.columns ?? 1) > 1,
            }"
            :style="(control.columns ?? 1) > 1 ? { '--sdk-form-cols': String(control.columns) } : undefined"
            :paths="drawn(control.itemFields, true).map((child) => path + '/' + index + child.path)"
          >
            <form-row-field
              v-for="child in drawn(control.itemFields, true)"
              :key="child.path"
              :field="child"
              :path="path"
              :index="index"
              :disabled="off"
            ></form-row-field>
          </form-advanced-section>
        </div>
        <div v-if="!control.numbered && !off && !arrayFixedRows" class="sdk-form-row-tools">
          <template v-if="arrayReorderable">
            <el-button text :disabled="index === 0" @click="move(index, index - 1)">{{ t("platform.formMoveUp") }}</el-button>
            <el-button text :disabled="index === rows.length - 1" @click="move(index, index + 1)">{{ t("platform.formMoveDown") }}</el-button>
          </template>
          <el-button text type="danger" @click="remove(index)">{{ t("platform.formRemove") }}</el-button>
        </div>
        <div v-if="arrayItemFooter(row, index)" class="sdk-form-row-footer">
          <component
            :is="RenderArrayItemFooter"
            :render="arrayItemFooter(row, index)!.slot"
            :scope="arrayItemFooter(row, index)!.props"
          />
        </div>
      </div>
      <el-button v-if="!off && !arrayFixedRows" class="sdk-form-add" @click="addRow">{{ control.addLabel ?? t("platform.formAdd") }}</el-button>
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
  </form-field-frame>
</template>

<style scoped>
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
  box-shadow: inset 0 0 0 1px var(--brand-link);
}
.sdk-form-avatar-icon:disabled,
.sdk-form-avatar-color:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.sdk-form-field-wide {
  width: 100%;
}
.sdk-form-field-count {
  width: 100%;
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-placeholder);
  font-size: var(--text-xs);
}
.sdk-form-field-time {
  width: 160px;
}
.sdk-form-field-number-stepper {
  width: min(240px, 100%);
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
.sdk-form-object.is-multi-col {
  display: grid;
  grid-template-columns: repeat(var(--sdk-form-cols, 2), minmax(0, 1fr));
  gap: 0 var(--spacing-md);
}
.sdk-form-object.is-panel {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-lighter);
}
.sdk-form-object-advanced,
.sdk-form-object.is-multi-col > .sdk-form-object-remove,
.sdk-form-object.is-multi-col > .sdk-form-add {
  grid-column: 1 / -1;
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
.sdk-form-row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.sdk-form-row-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding-inline: 6px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.sdk-form-row-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--spacing-md);
}
.sdk-form-row-fields.is-multi-col {
  display: grid;
  grid-template-columns: repeat(var(--sdk-form-cols, 2), minmax(0, 1fr));
  gap: 0 var(--spacing-md);
}
.sdk-form-row-fields.is-multi-col :deep(.sdk-form-field) {
  min-width: 0;
}
.sdk-form-row-advanced {
  flex-basis: 100%;
  grid-column: 1 / -1;
}
.sdk-form-row-tools {
  display: flex;
  justify-content: flex-end;
}
.sdk-form-row-footer {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--ui-divider);
}
.sdk-form-array-empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
/* Compact inline single-row object-array grid (for example HTTP headers: name | value | delete). */
.sdk-form-inline-row {
  display: grid;
  grid-template-columns: repeat(var(--sdk-inline-cols, 2), minmax(0, 1fr));
  gap: var(--spacing-sm);
  align-items: start;
}
.sdk-form-inline-row.has-remove {
  grid-template-columns: repeat(var(--sdk-inline-cols, 2), minmax(0, 1fr)) auto;
}
.sdk-form-inline-row :deep(.sdk-form-field) {
  min-width: 0;
  margin-bottom: 0;
}
.sdk-form-inline-row :deep(.el-form-item__label) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.sdk-form-inline-remove {
  padding-inline: var(--spacing-xs);
}
.sdk-form-add-inline {
  padding-inline: 0;
}
/* Compact bordered table editor for object-array fields (fixed-row routing matrices, etc.). */
.sdk-form-table-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
  overflow-x: auto;
}
.sdk-form-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: var(--text-sm);
}
.sdk-form-table th,
.sdk-form-table td {
  padding: var(--spacing-xs) var(--spacing-sm);
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px solid var(--ui-divider);
}
.sdk-form-table thead th {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  white-space: nowrap;
}
.sdk-form-table tbody tr:last-child td {
  border-bottom: 0;
}
.sdk-form-table td :deep(.sdk-form-field) {
  min-width: 0;
  margin-bottom: 0;
}
.sdk-form-table td :deep(.el-form-item__label) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.sdk-form-table-actions-head,
.sdk-form-table-actions-cell {
  width: 44px;
  text-align: center;
}
.sdk-form-add,
.sdk-form-object-remove {
  align-self: flex-start;
}
@container sdk-owner-form (max-width: 640px) {
  .sdk-form-object.is-multi-col,
  .sdk-form-row-fields.is-multi-col {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
