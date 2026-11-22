<script setup lang="ts">
/**
 * A non-rendering member: nothing is drawn here. Its projection declares data the panel's own code reads with
 * `usePanelData(member, name)` for coordination (when no component output carries it), or operations invoked with
 * `usePanelOperation(member, name)`. Business fields are rendered by components, not in the panel template.
 */
defineOptions({ name: "PanelData" });
</script>

<template><template v-if="false"></template></template>
