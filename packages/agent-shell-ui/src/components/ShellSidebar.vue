<script setup lang="ts">
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { ShellWorkbenchDeclaration } from "../types";
import ShellNavBody from "./ShellNavBody.vue";

/**
 * The conversation shell's own sidebar: brand, then the navigation body (`ShellNavBody`), then the host's footer.
 *
 * Under the platform shell the body moves into the application panel instead, and the shell runs embedded without this
 * component; the footer slot is kept only for hosts that still draw an account row of their own.
 */
defineProps<{
  workbench: ShellWorkbenchDeclaration;
  agents: AgentHostAgent[];
  agentId: string | null;
  sessions: AgentHostSession[];
  sessionsState: "loading" | "ready" | "error";
  hasMore: boolean;
  sessionId: string | null;
  featureId: string | null;
}>();
defineEmits<{
  newConversation: [];
  selectFeature: [id: string];
  featureAction: [id: string];
  selectAgent: [id: string];
  selectSession: [id: string];
  deleteSession: [id: string];
  loadMore: [];
  retry: [];
}>();
</script>

<template>
  <nav class="shell-sidebar" :aria-label="workbench.label">
    <div class="brand">
      <slot name="brand">
        <span class="brand-name">{{ workbench.label }}</span>
      </slot>
    </div>

    <ShellNavBody
      :workbench="workbench"
      :agents="agents"
      :agent-id="agentId"
      :sessions="sessions"
      :sessions-state="sessionsState"
      :has-more="hasMore"
      :session-id="sessionId"
      :feature-id="featureId"
      @new-conversation="$emit('newConversation')"
      @select-feature="$emit('selectFeature', $event)"
      @feature-action="$emit('featureAction', $event)"
      @select-agent="$emit('selectAgent', $event)"
      @select-session="$emit('selectSession', $event)"
      @delete-session="$emit('deleteSession', $event)"
      @load-more="$emit('loadMore')"
      @retry="$emit('retry')"
    />

    <div class="footer">
      <slot name="footer" />
    </div>
  </nav>
</template>

<style scoped>
/* The conversation shell's sidebar: on canvas with no divider. The rows live in ShellNavBody. */
.shell-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0 8px 8px;
  box-sizing: border-box;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--page-header-height);
  padding: 0 8px;
  flex-shrink: 0;
}
.brand-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.footer {
  padding-top: 4px;
}
.footer:empty {
  display: none;
}
</style>
