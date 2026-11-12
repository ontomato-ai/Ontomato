<script setup lang="ts">
import type { ShellTaskPort } from "../../host";
import { useTaskProcess } from "../../useTaskProcess";
import ShellProcess from "../ShellProcess.vue";
import TaskMarkdown from "./TaskMarkdown.vue";

/** The retriever's own thinking, notes and steps, live while it runs; its answer is its last note here. */
const props = defineProps<{ port: ShellTaskPort; sessionId: string; taskId: string; runId: string }>();
const { response } = useTaskProcess(props.port, props.sessionId, props.taskId, props.runId);
</script>

<template>
  <div v-if="response" class="task-process">
    <template v-for="block in response.process" :key="block.key">
      <ShellProcess v-if="block.kind === 'steps'" :steps="block.steps" :active="block.active" />
      <div v-else-if="block.kind === 'note'" class="task-note">
        <TaskMarkdown :content="block.text" :final="block.final" />
      </div>
    </template>
    <div v-if="response.answerText" class="task-note">
      <TaskMarkdown :content="response.answerText" final />
    </div>
  </div>
</template>

<style scoped>
.task-process {
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
  min-width: 0;
}
.task-note {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm);
}
</style>
