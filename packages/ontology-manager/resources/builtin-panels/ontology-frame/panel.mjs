import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/** Canonical route paths mapped to the frame's declared count read members. */
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
  "/ontology/products": "shapes",
  "/ontology/agents": "bot",
};

function readCount(state) {
  if (!state) return null;
  if (state.status === "empty") return 0;
  if (state.status !== "ready") return null;
  const value = state.value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && typeof value.total === "number" && Number.isFinite(value.total)) {
    return value.total;
  }
  return null;
}

await mountPanel({
  setup() {
    const context = usePanelContext();
    const visiblePaths = new Set();
    for (const use of context.entryMenu.value?.panelUses ?? []) {
      visiblePaths.add(use.path);
    }
    for (const group of context.hostMenu?.value ?? []) {
      for (const item of group.items) {
        visiblePaths.add(item.id);
      }
    }
    // Workflows and triggers share the action-management permission with Actions and Capability Map.
    if (visiblePaths.has("/ontology/assets/actions") || visiblePaths.has("/ontology/assets/capability-map")) {
      visiblePaths.add("/ontology/assets/workflows");
      visiblePaths.add("/ontology/assets/triggers");
    }

    // Subscribe only to owner count reads for entries this reader is authorized to see.
    const readers = {};
    for (const [path, member] of Object.entries(COUNT_MEMBERS)) {
      if (visiblePaths.has(path)) {
        readers[path] = usePanelData(member, "rows");
      }
    }

    const counts = computed(() => {
      const next = {};
      for (const [path, reader] of Object.entries(readers)) {
        const value = readCount(reader.value);
        if (value !== null) next[path] = value;
      }
      return next;
    });

    function openEntry(path) {
      const address = path.startsWith("/ontology/") ? path : `${path}?navigationContext=ontology`;
      void context.navigate(address);
    }

    return {
      t: context.t,
      counts,
      icons: ENTRY_ICONS,
      openEntry,
    };
  },
});
