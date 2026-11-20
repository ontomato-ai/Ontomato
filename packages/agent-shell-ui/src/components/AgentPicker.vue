<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import AgentAvatar from "./AgentAvatar.vue";

/**
 * Chooses one agent: a trigger with the current agent's avatar and name, and a list of every agent (avatar, name, one
 * line of description, a check on the current one). The conversation shell's column heads with it; the platform home's
 * question box carries it as a borderless pill. The list floats above the page, so a clipping container does not cut it.
 */
const props = withDefaults(
  defineProps<{
    agents: readonly Pick<AgentHostAgent, "id" | "name" | "description" | "icon">[];
    agentId: string | null;
    /** What it chooses ("Agent"): its accessible name, and the trigger's text while no agent is shown. */
    label: string;
    variant?: "head" | "pill" | "home";
  }>(),
  { variant: "head" },
);
const emit = defineEmits<{ select: [id: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const triggerButton = ref<HTMLButtonElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const popupStyle = ref<Record<string, string>>({});

const current = computed(() => props.agents.find((agent) => agent.id === props.agentId) ?? null);
/** The trigger's accessible name: what it switches, and the agent it currently shows. */
const triggerLabel = computed(() => `${props.label}: ${current.value?.name ?? "—"}`);

function onDocumentPointer(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}
/**
 * The list floats above the page rather than in its flow, so it is placed against the viewport: under the trigger
 * while the viewport has room for it there, and above it otherwise — a composer at the foot of the page or of the
 * window would have its list cut off by the bottom edge, hiding every agent but the first.
 */
function position() {
  const trigger = triggerButton.value?.getBoundingClientRect();
  if (!trigger) return;
  const width = Math.min(props.variant === "home" ? 360 : 320, window.innerWidth - 32);
  const gap = props.variant === "home" ? 8 : 4;
  const below = window.innerHeight - trigger.bottom - gap - 16;
  const above = trigger.top - gap - 16;
  const opensUp = below < 160 && above > below;
  // Opened upwards the list hangs from the trigger's top edge: its bottom stays there however few items it has.
  popupStyle.value = {
    left: `${Math.max(16, Math.min(trigger.left, window.innerWidth - width - 16))}px`,
    ...(opensUp
      ? { bottom: `${window.innerHeight - trigger.top + gap}px`, maxHeight: `${Math.max(80, above)}px` }
      : { top: `${trigger.bottom + gap}px`, maxHeight: `${Math.max(80, below)}px` }),
    width: `${width}px`,
    "--agent-menu-origin": opensUp ? "bottom left" : "top left",
    "--agent-menu-offset": opensUp ? "4px" : "-4px",
  };
}
async function show() {
  open.value = true;
  position();
  await nextTick();
  if (!open.value) return;
  if (popup.value) {
    popup.value.inert = false;
    if (!popup.value.matches(":popover-open")) popup.value.showPopover?.();
  }
  document.addEventListener("pointerdown", onDocumentPointer);
  window.addEventListener("resize", position);
  document.addEventListener("scroll", position, true);
}
function close(restoreFocus = false) {
  if (!open.value) return;
  if (restoreFocus) triggerButton.value?.focus();
  if (popup.value && props.variant === "home") popup.value.inert = true;
  else popup.value?.hidePopover?.();
  open.value = false;
  document.removeEventListener("pointerdown", onDocumentPointer);
  window.removeEventListener("resize", position);
  document.removeEventListener("scroll", position, true);
}
function choose(id: string) {
  close(true);
  if (id !== props.agentId) emit("select", id);
}

onBeforeUnmount(() => close());
</script>

<template>
  <div ref="root" class="agent-switch" :class="variant">
    <button
      ref="triggerButton"
      type="button"
      class="switch-trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="triggerLabel"
      :title="variant === 'home' ? current?.name : undefined"
      :disabled="agents.length === 0"
      @click="open ? close() : show()"
      @keydown.escape.stop="close(true)"
    >
      <AgentAvatar v-if="current" :icon="current.icon" :size="variant === 'pill' ? 20 : 24" />
      <span class="switch-name">{{ current?.name ?? label }}</span>
      <ChevronDown :size="variant === 'head' ? 16 : variant === 'home' ? 12 : 14" class="switch-chevron" :class="{ open }" aria-hidden="true" />
    </button>
    <Transition name="home-agent-menu" :css="variant === 'home'">
      <ul v-if="open" ref="popup" popover="manual" :style="popupStyle" class="agent-menu" role="listbox" :aria-label="label" @keydown.escape.stop="close(true)">
        <li v-for="agent in agents" :key="agent.id" role="option" :aria-selected="agent.id === agentId">
          <button type="button" class="agent-option" :class="{ current: agent.id === agentId }" @click="choose(agent.id)">
            <AgentAvatar :icon="agent.icon" :size="28" />
            <span class="option-text">
              <span class="option-name">{{ agent.name }}</span>
              <span v-if="agent.description" class="option-description">{{ agent.description }}</span>
            </span>
            <Check v-if="agent.id === agentId" :size="16" class="option-check" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.agent-switch {
  position: relative;
}
.agent-switch.head {
  min-height: 36px;
}
.switch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  cursor: pointer;
}
/* The column's head: the full width of the column, in the head's type. */
.head .switch-trigger {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.head .switch-trigger:hover {
  background: var(--shell-panel-hover);
}
/* A borderless pill among other controls (a composer's row): the row's control height, no height of its own. */
.pill .switch-trigger {
  height: var(--shell-composer-control, var(--control-height));
  padding: 0 10px 0 5px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.pill .switch-trigger:hover {
  background: var(--el-fill-color-light);
}
.home .switch-trigger {
  width: fit-content;
  min-width: 0;
  height: auto;
  padding: 2px 6px;
  gap: 8px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
.home .switch-trigger > :not(.switch-name) { flex: none; }
.home .switch-trigger:is(:hover, [aria-expanded="true"]) { background: var(--el-fill-color-light); }
.switch-trigger:disabled {
  cursor: default;
}
.switch-trigger:disabled:hover {
  background: transparent;
}
.switch-name {
  min-width: 0;
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head .switch-name {
  flex: 1;
}
.switch-chevron {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast);
}
.switch-chevron.open {
  transform: rotate(180deg);
}
.agent-menu {
  position: fixed;
  /* `[popover]` arrives with `inset: 0`; cleared, the one edge placed against the trigger decides where the list sits. */
  inset: auto;
  margin: 0;
  padding: var(--spacing-xs);
  overflow-y: auto;
  box-sizing: border-box;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.home .agent-menu { border: 1px solid var(--el-border-color); border-radius: var(--radius-lg); }
.home-agent-menu-enter-active, .home-agent-menu-leave-active {
  transform-origin: var(--agent-menu-origin);
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}
.home-agent-menu-enter-from, .home-agent-menu-leave-to {
  opacity: 0;
  transform: translateY(var(--agent-menu-offset)) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .home-agent-menu-enter-active, .home-agent-menu-leave-active { transition: none; }
}
.agent-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.agent-option:hover {
  background: var(--shell-panel-hover);
}
.agent-option.current {
  background: var(--shell-panel-selected);
  font-weight: var(--font-semibold);
}
.agent-option.current:hover {
  background: var(--shell-panel-selected-hover);
}
.option-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.option-name {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.option-description {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.option-check {
  flex-shrink: 0;
  color: var(--el-color-primary);
}
.switch-trigger:focus-visible,
.agent-option:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
