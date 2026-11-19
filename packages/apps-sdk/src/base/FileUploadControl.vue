<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { slotInputState, usePanelContext, useProjectionSlot } from "../panel/context";
import { PlatformUploadConflict } from "../panel/platform-objects";

/**
 * File upload/import control bound to a declared `PlatformOperation`. Optionally presents format rules before opening
 * the file picker, enforces declared `accept` extensions before sending, invokes the projection's operation handler
 * (which sends multipart `FormData` along its declared method/path through the bridge), and prompts for explicit
 * overwrite confirmation when the owner reports `PlatformUploadConflict`.
 */
const props = withDefaults(
  defineProps<{
    /** Operation published by this projection to invoke; defaults to the first published operation. */
    operation?: string;
    /** Optional slot input whose panel state holds the target object, when the upload targets one object. */
    input?: string;
    /** Optional extra parameters merged into `call.input` alongside `{ file, overwrite }`. */
    params?: Readonly<Record<string, unknown>>;
    /** Trigger button label (panel message key via `panel.t` or literal; defaults to the operation label). */
    label?: string;
    /** Button emphasis: `"primary"` or `"default"`. */
    type?: "primary" | "default";
    /** Accepted file extensions or MIME types (e.g. `".zip"`). Extensions starting with `.` are enforced before upload. */
    accept?: string;
    /** Optional title for the format-rules dialog (defaults to the trigger button label). */
    dialogTitle?: string;
    /** Optional introductory text shown in the pre-upload dialog (resolved via `panel.t`). */
    intro?: string;
    /** Optional list of format rules shown in the pre-upload dialog (each resolved via `panel.t`). */
    rules?: readonly string[];
    /** Optional label for the choose-file button inside the dialog. */
    chooseLabel?: string;
    /** Optional label for the confirm button in the overwrite dialog. */
    overwriteLabel?: string;
    /** Optional validation message when the selected file extension is rejected. */
    invalidTypeMessage?: string;
    /** Disables the upload trigger. */
    disabled?: boolean;
  }>(),
  {
    operation: "",
    input: undefined,
    params: undefined,
    label: undefined,
    type: "primary",
    accept: undefined,
    dialogTitle: undefined,
    intro: undefined,
    rules: undefined,
    chooseLabel: undefined,
    overwriteLabel: undefined,
    invalidTypeMessage: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  /** Emitted after the upload operation succeeds. */
  uploaded: [result: unknown, meta: { readonly file: File; readonly overwrite: boolean }];
  /** Emitted when validation or the upload operation fails. */
  error: [error: Error];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();

const fileInput = ref<HTMLInputElement | null>(null);
const rulesOpen = ref(false);
const uploading = ref(false);
const failure = shallowRef<Error | null>(null);
const pendingConflict = shallowRef<{ file: File; message: string } | null>(null);

const published = computed(() => {
  const registration = panel.instance.projections.value.find((item) => item.slot === slot.slot);
  if (!registration) throw new Error(`The projection in slot '${slot.slot}' is not registered yet`);
  const found = props.operation
    ? registration.ports.operations.find((item) => item.name === props.operation)
    : registration.ports.operations[0];
  if (!found) throw new Error(`The projection in slot '${slot.slot}' publishes no operation '${props.operation}'`);
  return found;
});

const targetState = computed(() => slotInputState(panel.manifest, slot.slot, props.input));
const target = computed<PanelOperationCall["target"]>(() => {
  if (!targetState.value) return null;
  const selected = panel.instance.state.values.value[targetState.value];
  return selected && typeof selected === "object"
    ? { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey }
    : null;
});

const triggerLabel = computed(() => (props.label ? panel.t(props.label) : published.value.label));
const hasRulesDialog = computed(() => Boolean(props.intro || props.rules?.length));
const allowedExtensions = computed(() =>
  (props.accept ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.startsWith(".")),
);
const isDisabled = computed(() => props.disabled || uploading.value || (targetState.value !== null && target.value === null));

function openPicker() {
  if (fileInput.value) {
    fileInput.value.value = "";
    fileInput.value.click();
  }
}

function onTriggerClick() {
  failure.value = null;
  if (hasRulesDialog.value) rulesOpen.value = true;
  else openPicker();
}

function checkExtension(file: File): boolean {
  if (!allowedExtensions.value.length) return true;
  const lower = file.name.toLowerCase();
  return allowedExtensions.value.some((ext) => lower.endsWith(ext));
}

async function submitFile(file: File, overwrite: boolean) {
  uploading.value = true;
  failure.value = null;
  try {
    const result = await panel.invoke(published.value.handlerRef, {
      target: target.value,
      input: { ...(props.params ?? {}), file, overwrite },
    });
    pendingConflict.value = null;
    panel.instance.refreshObjects();
    emit("uploaded", result, { file, overwrite });
  } catch (reason: unknown) {
    if (!overwrite && reason instanceof PlatformUploadConflict) {
      pendingConflict.value = { file, message: reason.message };
      return;
    }
    const err = reason instanceof Error ? reason : new Error(String(reason));
    failure.value = err;
    emit("error", err);
  } finally {
    uploading.value = false;
  }
}

function onFileChange(event: Event) {
  const inputEl = event.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  inputEl.value = "";
  rulesOpen.value = false;
  if (!file) return;
  if (!checkExtension(file)) {
    const message = props.invalidTypeMessage
      ? panel.t(props.invalidTypeMessage)
      : t("platform.uploadInvalidType", { accept: props.accept ?? "" });
    const err = new Error(message);
    failure.value = err;
    emit("error", err);
    return;
  }
  void submitFile(file, false);
}

function confirmOverwrite() {
  const conflict = pendingConflict.value;
  if (!conflict) return;
  pendingConflict.value = null;
  void submitFile(conflict.file, true);
}

function cancelOverwrite() {
  pendingConflict.value = null;
}
</script>

<template>
  <div class="sdk-file-upload">
    <button
      type="button"
      class="sdk-file-upload-btn sdk-file-upload-trigger"
      :class="{ primary: type === 'primary' }"
      :disabled="isDisabled"
      @click="onTriggerClick"
    >
      {{ uploading ? t("platform.uploadUploading") : triggerLabel }}
    </button>
    <input
      ref="fileInput"
      type="file"
      class="sdk-file-upload-input"
      :accept="accept"
      @change="onFileChange"
    />
    <p v-if="failure" role="alert" class="sdk-file-upload-error">{{ failure.message }}</p>

    <div v-if="rulesOpen" class="sdk-file-upload-backdrop" @click.self="rulesOpen = false">
      <div role="dialog" aria-modal="true" class="sdk-file-upload-modal">
        <h3 class="sdk-file-upload-modal-title">{{ dialogTitle ? panel.t(dialogTitle) : triggerLabel }}</h3>
        <p v-if="intro" class="sdk-file-upload-intro">{{ panel.t(intro) }}</p>
        <ul v-if="rules?.length" class="sdk-file-upload-rules">
          <li v-for="(rule, index) in rules" :key="index">{{ panel.t(rule) }}</li>
        </ul>
        <div class="sdk-file-upload-modal-actions">
          <button type="button" class="sdk-file-upload-btn" @click="rulesOpen = false">
            {{ t("platform.uploadCancel") }}
          </button>
          <button type="button" class="sdk-file-upload-btn primary sdk-file-upload-choose" @click="openPicker">
            {{ chooseLabel ? panel.t(chooseLabel) : t("platform.uploadChooseFile") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="pendingConflict" class="sdk-file-upload-backdrop" @click.self="cancelOverwrite">
      <div role="alertdialog" aria-modal="true" class="sdk-file-upload-modal">
        <h3 class="sdk-file-upload-modal-title">{{ t("platform.uploadConfirmTitle") }}</h3>
        <p class="sdk-file-upload-intro">{{ pendingConflict.message }}</p>
        <div class="sdk-file-upload-modal-actions">
          <button type="button" class="sdk-file-upload-btn sdk-file-upload-cancel" @click="cancelOverwrite">
            {{ t("platform.uploadCancel") }}
          </button>
          <button type="button" class="sdk-file-upload-btn primary sdk-file-upload-overwrite" @click="confirmOverwrite">
            {{ overwriteLabel ? panel.t(overwriteLabel) : t("platform.uploadOverwrite") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sdk-file-upload {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}
.sdk-file-upload-input {
  display: none;
}
.sdk-file-upload-btn {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--el-font-size-small, 12px);
  min-height: 30px;
  padding: 4px 12px;
}
.sdk-file-upload-btn.primary {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: var(--el-color-white, #fff);
}
.sdk-file-upload-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.sdk-file-upload-error {
  color: var(--el-color-danger);
  font-size: var(--el-font-size-small, 12px);
  margin: 0;
}
.sdk-file-upload-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 16px;
  position: fixed;
  z-index: 1000;
}
.sdk-file-upload-modal {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md, 8px);
  max-width: 480px;
  padding: 16px 20px;
  width: 100%;
}
.sdk-file-upload-modal-title {
  font-size: var(--text-base, 15px);
  margin: 0 0 8px;
}
.sdk-file-upload-intro {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 13px);
  margin: 0 0 8px;
}
.sdk-file-upload-rules {
  color: var(--el-text-color-regular);
  display: grid;
  font-size: var(--text-sm, 13px);
  gap: 4px;
  margin: 0 0 14px;
  padding-left: 1.2em;
}
.sdk-file-upload-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
