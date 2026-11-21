import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const record = computed(() => instance.state.values.value.record ?? null);
    const issue = computed(() => instance.state.values.value.issue ?? null);
    const anchored = computed(() => instance.state.values.value.issueId ?? null);
    const rec = usePanelData("report", "record");
    const rows = usePanelData("report", "issues");
    const sources = usePanelData("allReader", "sources");
    const issueRows = computed(() => (rows.value.status === "ready" ? rows.value.value : []));
    const sourceRows = computed(() => (sources.value.status === "ready" ? sources.value.value : []));
    const recValue = computed(() => (rec.value.status === "ready" ? rec.value.value : null));
    const recFields = computed(() => recValue.value?.fields ?? {});
    const sourceTitles = computed(() => {
      const map = {};
      for (const item of sourceRows.value) map[item.primaryKey] = item.label;
      return map;
    });
    const sourceTitle = (id) => sourceTitles.value[id] ?? id;
    // Cited-source keys arrive as a comma-separated list on the issue record.
    const sourceIdList = (row) => {
      const value = row.fields?.sourceIds;
      if (Array.isArray(value)) return value;
      return String(value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    };

    const tagKeys = {
      category: new Set(["ontology", "knowledge", "data"]),
      status: new Set(["proposed", "pending", "confirmed"]),
    };
    const tagText = (kind, value) => (tagKeys[kind].has(value) ? t(`panel.${kind}.${value}`) : value);
    const statusClass = (value) => (tagKeys.status.has(value) ? value : "");

    // A different record is a different report: a selection or reader anchor from another record cannot stay.
    watch(record, (next) => {
      if ((issue.value?.parent?.primaryKey ?? null) !== (next?.primaryKey ?? null)) {
        instance.state.setState({ issue: null, issueId: null, activeSource: null, activeAnchor: null });
      }
    });

    function toggleIssue(row) {
      const selected = issue.value?.primaryKey === row.primaryKey;
      instance.state.set("issue", selected ? null : {
        parent: { objectType: "platform:KnowledgeGovernanceRecord", primaryKey: record.value.primaryKey },
        primaryKey: row.primaryKey,
      });
    }
    // `issueId` is which finding the issue-scope reader is anchored under; the read takes its key.
    function openIssueSource(row, sourceId) {
      instance.state.setState({ issueId: row.primaryKey, activeSource: sourceId, activeAnchor: "issue" });
    }
    return { record, issue, anchored, rec, recValue, recFields, issueRows, sourceRows, sourceTitle, sourceIdList, tagText, statusClass, toggleIssue, openIssueSource };
  },
});
