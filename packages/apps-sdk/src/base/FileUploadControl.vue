<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { panelUploadAccepted, panelUploadSize, type PanelUploadReceipt } from "@ontomato/contracts/panel-upload";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMemberOperations } from "../panel/member";

/**
 * The control of one operation that takes a file (its owner declares an `upload`), run as the reader the way an
 * `OperationButton` runs a write. It may first show the format rules, then opens the file picker limited to the declared
 * kinds, checks the picked file against the declared kinds and size, stages it, and writes once with the staged file as
 * the declared input. The host confirms where the owner asks, naming the file. When the owner refuses with
 * `overwrite-on` (such as `SKILL_EXISTS`), the same staged file is sent again with `overwrite: true`, and the host's
 * confirmation, naming what is replaced, is the one dialog the reader answers. The owner's receipt is shown beneath.
 */
const props = withDefaults(
  defineProps<{
    /** The operation it runs: the projection's local name for it, under `operations`; its owner declares the upload. */
    operation: string;
    /** Further operation input sent beside the file. */
    params?: Readonly<Record<string, unknown>>;
    /** Trigger button label (panel message key via `panel.t` or literal; defaults to the operation label). */
    label?: string;
    /** Button emphasis: `"primary"` or `"default"`. */
    type?: "primary" | "default";
    /** Optional title for the format-rules dialog (defaults to the trigger button label). */
    dialogTitle?: string;
    /** Optional introductory text shown in the pre-upload dialog (resolved via `panel.t`). */
    intro?: string;
    /** Optional list of format rules shown in the pre-upload dialog (each resolved via `panel.t`). */
    rules?: readonly string[];
    /** Optional label for the choose-file button inside the dialog. */
    chooseLabel?: string;
    /** The owner's refusal code that means the item exists and the call may be repeated with `overwrite: true`. */
    overwriteOn?: string;
    /** Disables the upload trigger. */
    disabled?: boolean;
  }>(),
  {
    params: undefined,
    label: undefined,
    type: "primary",
    dialogTitle: undefined,
    intro: undefined,
    rules: undefined,
    chooseLabel: undefined,
    overwriteOn: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  /** Emitted with the host's receipt after the owner accepted the file. */
  uploaded: [response: PanelHumanOperationDispatchResponse, meta: { readonly file: PanelUploadReceipt; readonly overwrite: boolean }];
  /** Emitted when the file is refused before it is sent, or staging or the write fails. */
  error: [error: Error];
}>();

const { t, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();

const fileInput = ref<HTMLInputElement | null>(null);
const rulesOpen = ref(false);
const uploading = ref(false);
const failure = shallowRef<Error | null>(null);
/** What the owner said of the last file, with that file. */
const receipt = shallowRef<{ message: string; ok: boolean; file: PanelUploadReceipt } | null>(null);

/** The member's operations, as their owners admit them now. */
const operations = useMemberOperations();
if (!Object.hasOwn(slot.projection.operations ?? {}, props.operation))
  throw new Error(`The projection in member '${slot.slot}' names no operation '${props.operation}'`);
/** The owner's description of the upload; nothing is sent until the owner admits it. */
const published = computed<PanelOwnerOperationDescriptor | null>(() =>
  operations.value.status === "ready" ? operations.value.value[props.operation] ?? null : null);
const declared = computed(() => {
  const upload = published.value?.upload;
  if (published.value && !upload) throw new Error(`Operation '${props.operation}' takes no file`);
  return upload ?? null;
});
const operationId = computed(() => panel.instance.operationIdOf(slot.slot, props.operation));

const triggerLabel = computed(() => (props.label ? panel.t(props.label) : published.value?.label ?? ""));
const hasRulesDialog = computed(() => Boolean(props.intro || props.rules?.length));
const extensions = computed(() => declared.value?.accept.map((kind) => kind.extension).join(",") ?? "");
const isDisabled = computed(() => props.disabled || uploading.value || declared.value === null || Boolean(published.value?.unavailable));

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

function fail(reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  failure.value = error;
  emit("error", error);
}

/** Writes once with the staged file; on the declared refusal, once more with `overwrite: true`. */
async function write(file: PanelUploadReceipt, overwrite: boolean): Promise<void> {
  const input = {
    ...(props.params ?? {}), [declared.value!.input]: { kind: "upload", uploadId: file.uploadId }, ...(overwrite && { overwrite: true }),
  };
  const answer = await panel.instance.writeOperation(operationId.value, { call: { target: null, input } });
  if (answer.decision === "cancel") return;
  const response = answer.response;
  if (response.kind === "not-dispatched") {
    receipt.value = { message: response.message, ok: false, file };
    return;
  }
  const outcome = response.outcome;
  if (!overwrite && props.overwriteOn && outcome?.kind === "refusal" && outcome.code === props.overwriteOn) return write(file, true);
  if (outcome?.kind === "success") {
    receipt.value = { message: outcome.message ?? t("platform.operationDone"), ok: true, file };
    emit("uploaded", response, { file, overwrite });
    return;
  }
  const message = outcome === null || outcome.kind === "batch" ? t("platform.operationUnknown", { message: "" })
    : outcome.kind === "unknown" ? t("platform.operationUnknown", { message: outcome.message }) : outcome.message;
  receipt.value = { message, ok: false, file };
}

async function onFileChange(event: Event) {
  const inputEl = event.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  inputEl.value = "";
  rulesOpen.value = false;
  const upload = declared.value;
  if (!file || !upload) return;
  failure.value = null;
  receipt.value = null;
  // The owner's declaration is checked here so a wrong file is named at once; the server checks it again.
  if (!panelUploadAccepted(upload, file.name)) return fail(new Error(t("platform.uploadInvalidType", { accept: extensions.value })));
  if (file.size > upload.maxBytes) return fail(new Error(t("platform.uploadTooLarge", { size: panelUploadSize(upload.maxBytes, locale.value) })));
  uploading.value = true;
  try {
    await write(await panel.instance.uploadFile(operationId.value, file), false);
  } catch (reason) {
    fail(reason);
  } finally {
    uploading.value = false;
  }
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
      :accept="extensions"
      @change="onFileChange"
    />
    <p v-if="published?.unavailable" class="sdk-file-upload-hint">{{ published.unavailable.reason }}</p>
    <p v-if="failure" role="alert" class="sdk-file-upload-error">{{ failure.message }}</p>
    <p v-if="receipt" :role="receipt.ok ? 'status' : 'alert'" :class="receipt.ok ? 'sdk-file-upload-done' : 'sdk-file-upload-error'">
      {{ receipt.message }}
      <span class="sdk-file-upload-file">{{ t("platform.uploadFile", { name: receipt.file.name, size: panelUploadSize(receipt.file.size, locale) }) }}</span>
    </p>

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
  </div>
</template>

<style scoped>
.sdk-file-upload {
  align-self: flex-start;
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
.sdk-file-upload-hint,
.sdk-file-upload-done {
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-small, 12px);
  margin: 0;
}
.sdk-file-upload-file {
  color: var(--el-text-color-secondary);
  margin-inline-start: 6px;
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
