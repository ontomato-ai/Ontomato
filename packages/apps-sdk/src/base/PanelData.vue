<script setup lang="ts">
/**
 * A non-rendering member: nothing is drawn here. Its projection declares non-UI operations invoked through
 * `usePanelOperation(member, name, options?)`. Business data and fields are always read and rendered by official or
 * domain components, never in panel scripts or templates.
 */
defineOptions({ name: "PanelData" });
</script>

<template><template v-if="false"></template></template>
