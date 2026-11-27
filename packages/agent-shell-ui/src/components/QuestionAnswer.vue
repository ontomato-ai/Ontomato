<script setup lang="ts">
import { computed, inject } from "vue";
import { shellContextKey } from "../context";

const props = defineProps<{ text: string; question?: string }>();
const shell = inject(shellContextKey)!;
const content = computed(() => shell.labels.value.answered(props.text));
</script>

<template>
  <div class="answer-content">
    <div v-if="question" class="answer-question">{{ question }}</div>
    <div class="answer-text">{{ content }}</div>
  </div>
</template>

<style scoped>
.answer-content {
  min-width: 0;
}
.answer-question {
  display: -webkit-box;
  margin-bottom: 2px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.answer-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
