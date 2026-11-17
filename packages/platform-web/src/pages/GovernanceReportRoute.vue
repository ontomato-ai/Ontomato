<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { GovernancePage } from "@ontomato/ontology-manager";
import { PageComposer } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/**
 * One governance record's report, as the platform opens it: at its own address, and beside the conversation that wrote
 * it. The page itself is the Manager's (`GovernancePage`): this route gives it the address's props and, at its own
 * address, the platform's composer at its foot, so a message written here opens (or goes on in) the conversation with
 * the page beside it.
 *
 * Beside the conversation the shell passes `paired`, `recordId` and `issueId` and draws the frame: the page's own
 * navigation (selecting a finding) goes through `navigate`, which changes the address the conversation carries, and the
 * shell's close button closes it without leaving the conversation.
 */
const props = withDefaults(defineProps<{
  paired?: boolean;
  /** The record this page shows; the address's parameter when the page is its own application. */
  recordId?: string;
  /** The finding this page shows as selected, when its address names one. */
  issueId?: string;
  /** The page's own navigation beside a conversation: the conversation's page parameter, not the browser's address. */
  navigate?: (next: { issue?: string }) => void;
}>(), { paired: false, recordId: undefined, issueId: undefined, navigate: undefined });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** The record: the conversation's page parameter beside it, the address's own parameter at its own address. */
const recordId = computed(() => props.recordId ?? String(route.params.recordId ?? ""));
const issueId = computed(() => props.issueId ?? (typeof route.query.issue === "string" ? route.query.issue : undefined));
/** The page's own address, as the composer hands it to the counter: what this page is, down to the selected finding. */
const page = computed(() => {
  const query = new URLSearchParams();
  if (issueId.value) query.set("issue", issueId.value);
  return `${platformRoutes.governance.path.replace(":recordId", encodeURIComponent(recordId.value))}${query.size ? `?${query}` : ""}`;
});

/** Beside the conversation the selection changes the address the conversation carries; at its own address, its own. */
function select(id: string | null) {
  if (props.paired) props.navigate?.(id ? { issue: id } : {});
  else void router.replace({ query: { ...route.query, ...(id ? { issue: id } : { issue: undefined }) } });
}

/** Back to business knowledge, where the reader came from; the report itself holds nothing unsaved. */
const back = () => void router.push(platformRoutes.knowledge.path);

const labels = computed(() => ({
  placeholder: t("assistant.placeholder"),
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  agent: t("assistant.agent"),
}));
</script>

<template>
  <GovernancePage
    :record-id="recordId"
    :issue-id="issueId"
    :paired="props.paired"
    @select="select"
    @back="back"
  />
  <PageComposer v-if="!props.paired" :page="page" :labels="labels" />
</template>
