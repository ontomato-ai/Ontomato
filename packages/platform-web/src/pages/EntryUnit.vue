<script setup lang="ts">
/**
 * One entry's page as an application's frame holds it: inside a frame it stands where the frame's `<current-entry>` is,
 * at the width the frame gives it, and the panel draws its own `<page-header>` (or omits it).
 */
</script>

<template>
  <div class="panel-entry-unit">
    <div class="panel-entry-unit-body">
      <slot />
    </div>
    <div v-if="$slots.foot" class="panel-entry-unit-foot platform-page-gutter">
      <slot name="foot" />
    </div>
  </div>
</template>

<style scoped>
.panel-entry-unit {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.panel-entry-unit-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.panel-entry-unit-foot {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}
</style>
