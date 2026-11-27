<script setup lang="ts">
import QuestionAnswer from "./QuestionAnswer.vue";

/**
 * A message the reader sent while the reply was running, in the process where the run took it in: on the right like the
 * reader's own messages, quieter than a new question. An answer to one of the agent's questions says that it is one.
 */
const props = defineProps<{ text: string; answer: boolean; question?: string }>();
</script>

<template>
  <div class="process-input">
    <div class="process-bubble">
      <QuestionAnswer v-if="props.answer" :text="props.text" :question="props.question" />
      <template v-else>{{ props.text }}</template>
    </div>
  </div>
</template>

<style scoped>
.process-input {
  display: flex;
  justify-content: flex-end;
}
.process-bubble {
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
