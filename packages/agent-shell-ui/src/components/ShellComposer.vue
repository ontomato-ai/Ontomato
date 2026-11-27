<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowUp, GripHorizontal, LoaderCircle, MessageSquare, Minus, Send, Square } from "lucide-vue-next";
import { ActionTooltip } from "@ontomato/foundation-ui/overlay";
import type { ShellLabels } from "../types";
import type { ComposerEntry } from "../page-composer-entry";
import { useComposerCollapsed } from "../composer-collapsed";
import {
  clampComposerFloatPosition,
  composerFloatArea,
  currentComposerFloatPosition,
  draggedComposerFloatPosition,
  readComposerFabPosition,
  readComposerPosition,
  writeComposerFabPosition,
  writeComposerPosition,
  type ComposerFloatPosition,
} from "../composer-float-position";

/**
 * The one message box of the platform: the conversation shell's, the platform home's question box and the composer at
 * the foot of a page. One control; where it stands decides its shape (the user's decision, 2026-11-18, against Codex).
 *
 * In a conversation it is one block three lines high: two lines to write in and a line of controls under them — what the
 * message carries on the left, send or stop on the right. Two lines are not a limit: the block grows upward with the
 * message to eight lines and scrolls inside after that.
 *
 * Floating over a page (`floating`) it takes as little of the page as it can. Its upper layer holds its drag grip at
 * the left, the agent the message goes to (`agent`) in the middle and its fold button at the right; its lower layer is
 * one line of input and send, growing upward to six lines and scrolling after that. The grip drags the box inside the
 * page area, and this browser remembers that place separately from the round button's. Folded, the whole box becomes a
 * round button at the page's lower right; opened again, what was being written is still there. The fold is the reader's
 * own choice and this browser remembers it.
 *
 * A host may put more controls beside the agent (`tools`, the home's own choices). A narrow width gives way in the input,
 * never in the send button.
 *
 * While the agent works (`busy`) the reader still sends: the message goes into the running reply. The stop button stands
 * beside the send button then, which shows once there is something to send. Only a message still on its way (`sending`)
 * holds the next one back, and the box keeps its text until it can go.
 */
const props = defineProps<{
  busy: boolean;
  sending?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  minLines?: number;
  sendIcon?: "arrow" | "plane";
  sendText?: string;
  /** The box floats over a page (a page's foot, a full page beside the conversation) rather than standing under a conversation. */
  floating?: boolean;
  /** A floating box also names its fold and its round button; a conversation's box has neither. */
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop"> & Partial<Pick<ShellLabels, "collapseComposer" | "expandComposer">>;
  /**
   * A panel's conversation entry asking this box to show (design U18): it opens, takes the entry's text when there is
   * one, and waits for the reader to send. Each new `seq` is one request.
   */
  entry?: ComposerEntry | null;
}>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();
const text = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);
const hasText = computed(() => text.value.trim().length > 0);
const canSend = computed(() => !props.sending && !props.disabled && hasText.value);
const tooltipText = (value: unknown) => typeof value === "function" ? String((value as () => unknown)()) : String(value ?? "");
const { collapsed, setCollapsed } = useComposerCollapsed();
/** Only a floating box folds; the conversation's own is always there. */
/** Opened by an entry this time: the reader's remembered fold stays as it was. */
const opened = ref(false);
const folded = computed(() => props.floating && collapsed.value && !opened.value);

/**
 * Where the round button stands inside its page area. It is measured inward from the area's lower right, so the same
 * remembered place fits pages of different widths; when the area shrinks past it, the button is pulled back into view.
 * The stylesheet's corner remains the default until the reader drags it.
 */
const fab = ref<HTMLButtonElement | null>(null);
const fabPosition = ref<ComposerFloatPosition | null>(null);
const fabDragging = ref(false);
let rememberedFabPosition = readComposerFabPosition();
let fabArea: HTMLElement | null = null;
let fabDrag: {
  pointerId: number;
  x: number;
  y: number;
  start: ComposerFloatPosition;
  moved: boolean;
  target: HTMLElement;
} | null = null;
let suppressFabClickUntil = 0;

const fabStyle = computed(() => fabPosition.value
  ? { right: `${fabPosition.value.right}px`, bottom: `${fabPosition.value.bottom}px` }
  : undefined);
const fabSize = () => ({ width: fab.value?.offsetWidth ?? 44, height: fab.value?.offsetHeight ?? 44 });
const fabAreaSize = () => ({
  width: fabArea?.clientWidth ?? window.innerWidth,
  height: fabArea?.clientHeight ?? window.innerHeight,
});
const clampFabPosition = (position: ComposerFloatPosition) => clampComposerFloatPosition(position, fabAreaSize(), fabSize());

/** Draws the remembered or default place clamped to the area as it is now; a remembered place is kept clamped too. */
function syncFabPosition() {
  const element = fab.value;
  if (!element || !folded.value) return;
  fabArea ??= composerFloatArea(element);
  // Another visible page may have been dragged since this instance was drawn; storage is their shared place.
  rememberedFabPosition = readComposerFabPosition() ?? rememberedFabPosition;
  const current = rememberedFabPosition ?? fabPosition.value ?? currentComposerFloatPosition(element, fabArea);
  const next = clampFabPosition(current);
  fabPosition.value = next;
  if (rememberedFabPosition) {
    rememberedFabPosition = next;
    writeComposerFabPosition(next);
  }
}

const fabAreaSizer = new ResizeObserver(() => syncFabPosition());
watch(fab, (element) => {
  fabAreaSizer.disconnect();
  fabArea = element ? composerFloatArea(element) : null;
  if (fabArea) fabAreaSizer.observe(fabArea);
  if (element) syncFabPosition();
}, { flush: "post" });

function moveFabDrag(event: PointerEvent) {
  if (!fabDrag || event.pointerId !== fabDrag.pointerId) return;
  const dx = event.clientX - fabDrag.x;
  const dy = event.clientY - fabDrag.y;
  fabPosition.value = draggedComposerFloatPosition(fabDrag.start, dx, dy, fabAreaSize(), fabSize());
  if (Math.hypot(dx, dy) >= 4) {
    fabDrag.moved = true;
    fabDragging.value = true;
  }
}

function finishFabDrag(event?: PointerEvent) {
  if (!fabDrag || (event && event.pointerId !== fabDrag.pointerId)) return;
  const { target, moved } = fabDrag;
  target.removeEventListener("pointermove", moveFabDrag);
  target.removeEventListener("pointerup", finishFabDrag);
  target.removeEventListener("pointercancel", finishFabDrag);
  target.removeEventListener("lostpointercapture", finishFabDrag);
  fabDrag = null;
  fabDragging.value = false;
  if (!moved || !fabPosition.value) return;
  rememberedFabPosition = clampFabPosition(fabPosition.value);
  fabPosition.value = rememberedFabPosition;
  writeComposerFabPosition(rememberedFabPosition);
  suppressFabClickUntil = performance.now() + 300;
}

function startFabDrag(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  fabArea = composerFloatArea(target);
  syncFabPosition();
  const start = fabPosition.value ?? currentComposerFloatPosition(target, fabArea);
  fabDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, moved: false, target };
  target.setPointerCapture(event.pointerId);
  target.addEventListener("pointermove", moveFabDrag);
  target.addEventListener("pointerup", finishFabDrag);
  target.addEventListener("pointercancel", finishFabDrag);
  target.addEventListener("lostpointercapture", finishFabDrag);
}

function activateFab() {
  if (performance.now() < suppressFabClickUntil) return;
  unfold();
}

/**
 * The expanded floating box has its own remembered place, separate from the round button's. Its placement element is
 * the positioning reference and, while the box's bottom is on the page's bottom line, also the room the page leaves for
 * it. Dragged upward that element is zero high, so the measured dock leaves no room; dragged back down it is the box's
 * height again. There is no docked or floating mode to synchronize: the height follows the bottom distance directly.
 */
const placement = ref<HTMLElement | null>(null);
const box = ref<HTMLFormElement | null>(null);
const composerPosition = ref<ComposerFloatPosition | null>(null);
const composerHeight = ref(0);
const composerDragging = ref(false);
let rememberedComposerPosition = composerPosition.value;
let composerDrag: {
  pointerId: number;
  x: number;
  y: number;
  start: ComposerFloatPosition;
  moved: boolean;
  target: HTMLElement;
} | null = null;

const composerAtBottom = computed(() => (composerPosition.value?.bottom ?? 0) === 0);
const composerFootGap = ref(0);
const placementStyle = computed(() => {
  if (!props.floating) return undefined;
  return { height: composerAtBottom.value ? `${composerHeight.value}px` : "0px" };
});
// The stored bottom counts upward from the box's resting bottom line. Off that line the foot's bottom padding is gone,
// so the rendered CSS distance is shifted by the measured padding and the box does not jump as the room appears or disappears.
const composerStyle = computed(() => {
  if (!props.floating || !composerPosition.value) return undefined;
  const bottom = composerPosition.value.bottom + (composerAtBottom.value ? 0 : composerFootGap.value);
  return { right: `${composerPosition.value.right}px`, bottom: `${bottom}px` };
});

/**
 * The box's horizontal room is its placement element (the page's content width). Its vertical room reaches from the
 * page area's top to that element's bottom, so a remembered place is pulled back when the window shrinks.
 */
function composerBoundary(): HTMLElement {
  let node = placement.value?.parentElement ?? null;
  while (node) {
    if (getComputedStyle(node).position === "relative") return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

function readComposerFootGap() {
  const parent = placement.value?.parentElement;
  if (!parent) return composerFootGap.value;
  const value = Number.parseFloat(getComputedStyle(parent).paddingBottom);
  // The first measure happens before a remembered upward place is applied, so the foot's padding is still its baseline.
  return Number.isFinite(value) && value > 0 ? value : composerFootGap.value;
}

const composerAreaSize = () => {
  const root = placement.value;
  if (!root) return { width: window.innerWidth, height: window.innerHeight };
  const boundary = composerBoundary();
  const parent = root.parentElement;
  const gap = readComposerFootGap();
  const presentGap = parent ? Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0 : gap;
  const restingBottom = root.getBoundingClientRect().bottom - Math.max(0, gap - presentGap);
  const vertical = restingBottom - boundary.getBoundingClientRect().top;
  return { width: root.clientWidth, height: Math.max(0, vertical) };
};
const composerSize = () => ({
  width: box.value?.offsetWidth ?? 0,
  height: box.value?.offsetHeight ?? composerHeight.value,
});
const clampComposerPosition = (position: ComposerFloatPosition) => {
  const area = composerAreaSize();
  const part = composerSize();
  // Before the page has a layout (or while it is hidden) there is no real bound to clamp to; wait for the resize.
  if (area.width <= 0 || area.height <= 0 || part.width <= 0 || part.height <= 0) return position;
  return clampComposerFloatPosition(position, area, part);
};

/** Measures and draws the remembered place clamped to the page area as it is now. */
function syncComposerPosition() {
  const element = box.value;
  if (!element || !placement.value || !props.floating || folded.value) return;
  composerHeight.value = Math.ceil(element.offsetHeight);
  composerFootGap.value = readComposerFootGap();
  // Another visible page may have been dragged since this instance was drawn; storage is their shared place.
  rememberedComposerPosition = readComposerPosition() ?? rememberedComposerPosition;
  const current = rememberedComposerPosition ?? composerPosition.value;
  if (!current) return;
  const next = clampComposerPosition(current);
  composerPosition.value = next;
  if (rememberedComposerPosition) {
    rememberedComposerPosition = next;
    writeComposerPosition(next);
  }
}

const composerPlacementSizer = new ResizeObserver(() => syncComposerPosition());
watch(placement, (element) => {
  composerPlacementSizer.disconnect();
  if (!element) return;
  composerPlacementSizer.observe(element);
  composerPlacementSizer.observe(composerBoundary());
  syncComposerPosition();
}, { flush: "post" });
const composerBoxSizer = new ResizeObserver(() => syncComposerPosition());
watch(box, (element, previous) => {
  if (previous) composerBoxSizer.unobserve(previous);
  if (element) composerBoxSizer.observe(element);
  if (element) syncComposerPosition();
}, { flush: "post" });

function moveComposerDrag(event: PointerEvent) {
  if (!composerDrag || event.pointerId !== composerDrag.pointerId) return;
  const dx = event.clientX - composerDrag.x;
  const dy = event.clientY - composerDrag.y;
  composerPosition.value = draggedComposerFloatPosition(composerDrag.start, dx, dy, composerAreaSize(), composerSize());
  if (dx !== 0 || dy !== 0) {
    composerDrag.moved = true;
    composerDragging.value = true;
  }
}

function finishComposerDrag(event?: PointerEvent) {
  if (!composerDrag || (event && event.pointerId !== composerDrag.pointerId)) return;
  const { target, moved } = composerDrag;
  target.removeEventListener("pointermove", moveComposerDrag);
  target.removeEventListener("pointerup", finishComposerDrag);
  target.removeEventListener("pointercancel", finishComposerDrag);
  target.removeEventListener("lostpointercapture", finishComposerDrag);
  composerDrag = null;
  composerDragging.value = false;
  if (!moved || !composerPosition.value) return;
  rememberedComposerPosition = clampComposerPosition(composerPosition.value);
  composerPosition.value = rememberedComposerPosition;
  writeComposerPosition(rememberedComposerPosition);
}

function startComposerDrag(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const element = box.value;
  const root = placement.value;
  if (!element || !root) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  syncComposerPosition();
  const start = composerPosition.value ?? currentComposerFloatPosition(element, root);
  composerDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, moved: false, target };
  target.setPointerCapture(event.pointerId);
  target.addEventListener("pointermove", moveComposerDrag);
  target.addEventListener("pointerup", finishComposerDrag);
  target.addEventListener("pointercancel", finishComposerDrag);
  target.addEventListener("lostpointercapture", finishComposerDrag);
}

function syncFloatingPositions() {
  syncFabPosition();
  syncComposerPosition();
}

/** The lines the input shows before it grows, and the lines it grows to before it scrolls. */
const lines = computed(() => (props.floating ? { least: 1, most: 6 } : { least: Math.min(8, Math.max(1, props.minLines ?? 2)), most: 8 }));

/**
 * The input is as tall as the message, between its least and most lines; past the most, it scrolls inside. It is
 * measured again whenever the text or its width changes; the placeholder is a single line, cut with an ellipsis.
 */
function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  const style = getComputedStyle(el);
  const line = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const written = Math.max(1, Math.round((el.scrollHeight - padding) / line));
  const shown = Math.min(Math.max(written, lines.value.least), lines.value.most);
  el.style.height = `${shown * line + padding}px`;
  el.style.overflowY = written > lines.value.most ? "auto" : "hidden";
}
// After the textarea shows the change; a composer closed meanwhile (sent from the full page) is not measured.
watch([text, lines, folded], resize, { flush: "post" });
const sizer = new ResizeObserver(() => resize());
watch(input, (el, previous) => {
  if (previous) sizer.unobserve(previous);
  if (el) sizer.observe(el);
});
onMounted(resize);
onMounted(() => window.addEventListener("resize", syncFloatingPositions));
onBeforeUnmount(() => {
  sizer.disconnect();
  fabAreaSizer.disconnect();
  finishFabDrag();
  composerPlacementSizer.disconnect();
  composerBoxSizer.disconnect();
  finishComposerDrag();
  window.removeEventListener("resize", syncFloatingPositions);
});

function submit() {
  if (!canSend.value) return;
  emit("send", text.value);
  text.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !composing.value && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

/** Folding keeps what was written: it is the same box, out of the page's way. */
function fold() {
  opened.value = false;
  setCollapsed(true);
}

watch(() => props.entry?.seq, () => {
  const entry = props.entry;
  if (!entry) return;
  opened.value = true;
  if (entry.text !== null) text.value = entry.text;
  void Promise.resolve().then(() => input.value?.focus());
}, { immediate: true });
function unfold() {
  setCollapsed(false);
  void Promise.resolve().then(() => input.value?.focus());
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <button
    v-if="folded"
    ref="fab"
    type="button"
    class="composer-unfold"
    :class="{ dragging: fabDragging }"
    :style="fabStyle"
    :title="labels.expandComposer"
    :aria-label="labels.expandComposer"
    @pointerdown="startFabDrag"
    @click="activateFab"
  >
    <MessageSquare :size="20" :stroke-width="2.1" aria-hidden="true" />
  </button>
  <div
    v-else
    ref="placement"
    class="composer-placement"
    :class="{ floating, 'off-bottom': floating && !composerAtBottom }"
    :style="placementStyle"
  >
  <form
    ref="box"
    class="composer"
    :class="{ disabled, floating, placed: floating && composerPosition !== null, dragging: composerDragging }"
    :style="composerStyle"
    @submit.prevent="submit"
  >
    <!-- A floating box's upper layer: its drag grip at the left, the agent and host choices in the middle, its fold at the right. -->
    <div v-if="floating" class="composer-bar">
      <span class="composer-drag" @pointerdown="startComposerDrag">
        <GripHorizontal :size="16" aria-hidden="true" />
      </span>
      <div v-if="$slots.agent" class="composer-agent"><slot name="agent" /></div>
      <div v-if="$slots.tools" class="composer-tools"><slot name="tools" /></div>
      <button type="button" class="composer-fold" :title="labels.collapseComposer" :aria-label="labels.collapseComposer" @click="fold">
        <Minus :size="16" />
      </button>
    </div>
    <div class="composer-body">
      <textarea
        ref="input"
        v-model="text"
        rows="1"
        :placeholder="labels.placeholder"
        :aria-label="labels.placeholder"
        :disabled="disabled"
        :autofocus="autofocus"
        @keydown="onKeydown"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
      <div class="composer-controls">
        <template v-if="!floating">
          <div v-if="$slots.agent" class="composer-agent"><slot name="agent" /></div>
          <div v-if="$slots.tools" class="composer-tools"><slot name="tools" /></div>
        </template>
        <div v-if="$slots.context" class="composer-context"><slot name="context" /></div>
        <div class="composer-actions">
           <ActionTooltip v-if="busy && !sending" :content="tooltipText(labels.stop)">
          <button
            type="button"
            class="composer-button stop"
            :aria-label="labels.stop"
            @click="emit('stop')"
          >
            <Square :size="12" fill="currentColor" />
          </button>
          </ActionTooltip>
           <ActionTooltip v-if="sending || !busy || hasText" :content="tooltipText(labels.send)">
          <button
            type="submit"
            class="composer-button"
            :class="{ 'composer-button-text': sendText }"
            :disabled="!canSend"
             :aria-label="labels.send"
             :aria-busy="sending || undefined"
          >
             <LoaderCircle v-if="sending" :size="16" class="sending-spinner" aria-hidden="true" />
              <span v-else-if="sendText">{{ sendText }}</span>
              <Send v-else-if="sendIcon === 'plane'" :size="13" aria-hidden="true" />
            <ArrowUp v-else :size="16" aria-hidden="true" />
          </button>
          </ActionTooltip>
        </div>
      </div>
    </div>
  </form>
  </div>
</template>

<style scoped>
.composer-button.composer-button-text { inline-size: auto; padding-inline: var(--spacing-md); }
.sending-spinner { animation: composer-spin 1s linear infinite; }
@keyframes composer-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sending-spinner { animation: none; } }
/*
 * The placement element is invisible room. Floating, it is the box's positioning reference across the page's content
 * width; while the box is on the bottom line its height is the room the page leaves, and away from the bottom it is zero.
 * It never takes the pointer itself: only the box does.
 */
.composer-placement {
  min-width: 0;
}
.composer-placement.floating {
  position: relative;
  flex: none;
  width: 100%;
  overflow: visible;
  pointer-events: none;
}
.composer-placement.floating .composer.floating {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(760px, 100%);
  transform: translateX(-50%);
}
.composer-placement.floating .composer.floating.placed {
  left: auto;
  transform: none;
}
/*
 * One block. Under a conversation: the input across the whole width, two lines high to start, and the controls on the
 * line under it — what the message carries on the left, send on the right. Floating over a page: an upper layer with the
 * drag grip and the agent, and a lower layer where the input and send share one line. The conversation shell raises it
 * through --shell-composer-shadow; embedded chats keep it flat.
 */
.composer {
  container: shell-composer / inline-size;
  --composer-control: var(--control-height);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-dark);
  border-radius: var(--radius-2xl);
  background: var(--el-bg-color);
  box-shadow: var(--shell-composer-shadow, none);
  overflow: hidden;
  pointer-events: auto;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}
.composer:focus-within {
  border-color: var(--el-color-primary);
}
.composer.disabled {
  opacity: 0.6;
}
.composer-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-md);
}
.composer-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* Floating: the lower layer is one line, input and send, the input growing upward and send staying at its foot. */
.composer.floating .composer-body {
  flex-direction: row;
  align-items: flex-end;
}
.composer.floating .composer-controls {
  flex-shrink: 0;
}
.composer.floating textarea {
  flex: 1 1 auto;
}
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
.composer-drag,
.composer-fold,
.composer-unfold {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.composer-drag,
.composer-fold {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border-radius: var(--radius-md);
  background: transparent;
}
.composer-drag {
  touch-action: none;
  user-select: none;
}
.composer-drag,
.composer-drag:hover {
  cursor: grab;
}
.composer.dragging .composer-drag,
.composer.dragging .composer-drag:hover {
  cursor: grabbing;
  background: var(--el-fill-color);
}
.composer-fold {
  margin-inline-start: auto;
}
.composer-drag:hover,
.composer-fold:hover {
  background: var(--el-fill-color);
}
/*
 * Folded: a prominent brand-filled round FAB floating at the page's lower right by default. It is absolute even then,
 * so the zero-height dock owns no space; dragging only changes its inward distances inside the page area, and pointer
 * capture keeps the drag with the button above panel frames.
 */
.composer-unfold {
  position: absolute;
  right: var(--page-gutter);
  bottom: var(--shell-composer-foot);
  pointer-events: auto;
  touch-action: none;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--on-primary) 22%, var(--el-color-primary));
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  color: var(--on-primary);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--el-bg-color) 88%, transparent),
    0 6px 18px color-mix(in srgb, var(--el-color-primary) 34%, rgba(0, 0, 0, 0.2)),
    0 2px 6px rgba(0, 0, 0, 0.14);
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}
.composer-unfold:hover {
  background: var(--brand-primary-hover);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--el-bg-color) 92%, transparent),
    0 8px 22px color-mix(in srgb, var(--el-color-primary) 44%, rgba(0, 0, 0, 0.24)),
    0 3px 8px rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}
.composer-unfold:active {
  transform: translateY(0) scale(0.97);
}
.composer-unfold,
.composer-unfold.dragging {
  cursor: grab;
}
.composer-unfold.dragging,
.composer-unfold.dragging:hover,
.composer-unfold.dragging:active {
  cursor: grabbing;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .composer-unfold {
    transition: none;
  }
  .composer-unfold:hover,
  .composer-unfold:active {
    transform: none;
  }
}
.composer-agent,
.composer-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}
/* Narrow, the agent choice gives way before anything else: its name is cut to an ellipsis, then to the avatar alone. */
.composer-agent {
  flex-shrink: 1;
  max-width: 60%;
}
@container shell-composer (max-width: 300px) {
  .composer-agent .agent-switch:not(.home) .switch-name {
    display: none;
  }
}
/*
 * The message takes the width; its height is the one its lines set as it grows. Under a conversation it stands in a
 * column, where a flexible basis would override that height, so it does not flex there; floating, it shares one line with
 * send and takes what that line leaves.
 */
textarea {
  flex: none;
  width: 100%;
  min-width: 0;
  padding: calc((var(--composer-control) - var(--leading-base)) / 2) 0;
  box-sizing: border-box;
  border: 0;
  outline: none;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
textarea::placeholder {
  color: var(--el-text-color-placeholder);
  /* One line, cut short: a long hint never makes the box taller than a message. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* What the message carries, on the controls' line at the left; cut short rather than pushing send away. */
.composer-context {
  flex: 0 1 auto;
  max-width: 60%;
  min-width: 0;
}
.composer-context:empty {
  display: none;
}
.composer-actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  margin-inline-start: auto;
}
.composer-button {
  display: grid;
  place-items: center;
  width: var(--composer-control);
  height: var(--composer-control);
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  color: var(--on-primary);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    opacity var(--transition-fast);
}
.composer-button:hover:not(:disabled) {
  background: var(--brand-primary-hover);
}
.composer-button:disabled {
  background: var(--el-fill-color);
  color: var(--el-text-color-disabled);
  cursor: default;
}
.composer-button.stop {
  background: var(--el-text-color-primary);
  color: var(--el-bg-color);
}
.composer-button:focus-visible,
.composer-fold:focus-visible,
.composer-unfold:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.composer-unfold:focus-visible {
  outline-offset: 3px;
}
</style>
