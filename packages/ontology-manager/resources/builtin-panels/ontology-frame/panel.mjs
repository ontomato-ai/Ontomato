import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/** Canonical route paths mapped to the frame's declared ObjectCount members. */
const COUNT_MEMBERS = {
  "/ontology/objects": "objectTypes",
  "/ontology/attributes": "attributes",
  "/ontology/relations": "relationships",
  "/ontology/knowledge": "knowledge",
  "/ontology/assets/metrics": "metricViews",
  "/ontology/assets/functions": "functions",
  "/ontology/assets/actions": "actions",
  "/ontology/assets/workflows": "workflows",
  "/ontology/assets/triggers": "triggers",
  "/ontology/skills": "skills",
  "/ontology/components": "sdkComponents",
  "/ontology/projections": "projections",
  "/ontology/panels": "panels",
  "/ontology/applications": "applications",
  "/ontology/agents": "agents",
  "/permissions/members": "members",
  "/permissions/roles": "roles",
  "/permissions/policies": "policies",
  "/permissions/organization": "organizationUnits",
};

/** Curated platform icon keys matching each ontology manager menu entry. */
const ENTRY_ICONS = {
  "/ontology/playground": "network",
  "/ontology/objects": "boxes",
  "/ontology/attributes": "tags",
  "/ontology/relations": "link",
  "/ontology/visual-modeling": "visual-modeling",
  "/ontology/knowledge": "book-open",
  "/ontology/assets/metrics": "chart-column",
  "/ontology/assets/functions": "function",
  "/ontology/assets/actions": "mouse-pointer-click",
  "/ontology/assets/workflows": "git-branch",
  "/ontology/assets/triggers": "alarm-clock",
  "/ontology/skills": "puzzle",
  "/permissions/members": "users",
  "/permissions/roles": "user-cog",
  "/permissions/policies": "shield-check",
  "/permissions/organization": "building-2",
  "/ontology/assets/capability-map": "share-2",
  "/ontology/components": "component",
  "/ontology/projections": "layers",
  "/ontology/panels": "panels-top-left",
  "/ontology/applications": "app-window",
  "/ontology/agents": "bot",
};

function countMemberFor(path) {
  return Object.hasOwn(COUNT_MEMBERS, path) ? COUNT_MEMBERS[path] : undefined;
}

await mountPanel({
  setup() {
    const context = usePanelContext();
    const totals = Object.entries(COUNT_MEMBERS).map(([path, member]) => [
      path,
      usePanelOutput(member, "total"),
    ]);

    const trailingText = computed(() => {
      const next = {};
      for (const [path, total] of totals) {
        if (typeof total.value === "number" && Number.isFinite(total.value)) {
          next[path] = `(${total.value})`;
        }
      }
      return next;
    });

    function openEntry(path) {
      const address = path.startsWith("/ontology/") ? path : `${path}?navigationContext=ontology`;
      void context.navigate(address);
    }

    return {
      t: context.t,
      icons: ENTRY_ICONS,
      countMemberFor,
      trailingText,
      openEntry,
    };
  },
});
