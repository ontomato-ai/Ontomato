<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PanelHost, type PanelHostLabels } from "@ontomato/platform-shell";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import type { DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { candidatePanelHost } from "../panel-host";

/**
 * An author's preview of the panel candidate in one of their workspaces (design 6.2): the workspace's `panel.html`,
 * `panel.mjs` and `panel.json` at a ref — `working` or a commit — shown by the same panel host a registered panel is,
 * before anything is registered. The address names the workspace, the ref and the page key a draft for this page names;
 * the panel's state and a draft's link ride in its query as on any panel page.
 *
 * Node answers the candidate only to the workspace's author; anyone else is refused there and the refusal is shown. The
 * frame runs on the workspace's build-test context, so no request it makes is live.
 */
const props = defineProps<{
  workspaceId: string;
  /** `working` for the current files, or a commit of the workspace (the address's `ref`). */
  revision: string;
  /** The page key the candidate is previewed as: a draft written for this page names it. */
  pageKey: string;
}>();

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const port = computed(() => candidatePanelHost({ id: props.workspaceId, ref: props.revision, pageKey: props.pageKey }));
const key = computed(() => `${props.workspaceId}:${props.revision}:${props.pageKey}`);

const labels = computed<PanelHostLabels>(() => ({
  notStarted: t("platform.panelNotStarted"),
  failures: {
    fileUnavailable: t("platform.panelFileUnavailable", { file: "{file}" }),
    scriptThrew: t("platform.panelScriptThrew"),
    scriptRejected: t("platform.panelScriptRejected"),
  },
  content: { htmlRemoved: t("platform.panelHtmlRemoved"), styleOutside: t("platform.panelStyleOutside") },
}));

/** The preview's address without the panel's own state; a draft's link in the query stays for the panel to read. */
const address = computed(() => panelAddress(route.fullPath, {}));
const requestedState = computed(() => panelAddressState(route.fullPath));

function reportAddress(input: DisplayPageAddressInput) {
  if (route.fullPath !== input.address) void router.replace(input.address);
}
</script>

<template>
  <PanelHost
    :key="key"
    :port="port"
    :labels="labels"
    :label="t('platform.panelCandidateLabel', { ref: revision })"
    :address="address"
    :initial="requestedState"
    @display-address="reportAddress"
  />
</template>
