<template>
  <button type="button" class="dataset-selection-button"><slot /></button>
</template>

<style scoped>
.dataset-selection-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  margin: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: nowrap;
  cursor: pointer;
}
.dataset-selection-button:hover:not(:disabled) { background: var(--el-fill-color-light); border-color: var(--el-border-color-dark); }
.dataset-selection-button:active:not(:disabled) { background: var(--el-fill-color); }
.dataset-selection-button:disabled { cursor: not-allowed; color: var(--el-disabled-text-color); }
.dataset-selection-button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
</style>
