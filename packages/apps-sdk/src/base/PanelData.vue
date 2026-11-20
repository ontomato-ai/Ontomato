<script setup lang="ts">
/**
 * The member a panel draws itself: nothing is drawn here. Its projection declares the data the panel's own code reads,
 * each with `usePanelData(member, name)`, through the same read as every other member's, and draws in the page's own way.
 */
defineOptions({ name: "PanelData" });
</script>

<template><template v-if="false"></template></template>
