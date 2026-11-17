<script setup lang="ts">
import { computed, inject } from "vue";
import { shellContextKey } from "../context";

/**
 * A message the reader sent while the reply was running, in the process where the run took it in: on the right like the
 * reader's own messages, quieter than a new question. An answer to one of the agent's questions says that it is one.
 */
const props = defineProps<{ text: string; answer: boolean }>();
const shell = inject(shellContextKey)!;
const content = computed(() => (props.answer ? shell.labels.value.answered(props.text) : props.text));
</script>

<template>
  <div class="process-input">
    <p>{{ content }}</p>
  </div>
</template>

<style scoped>
.process-input {
  display: flex;
  justify-content: flex-end;
}
.process-input p {
  max-width: min(85%, 620px);
  margin: 0;
  padding: 6px 12px;
  border-radius: var(--radius-lg);
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
