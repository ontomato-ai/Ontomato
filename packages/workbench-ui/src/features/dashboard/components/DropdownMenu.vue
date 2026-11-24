<template>
  <el-dropdown
    v-bind="attrs"
    placement="bottom-end"
    :popper-options="dropdownBoundaryOptions"
    :trigger="trigger"
    :hide-on-click="hideOnClick"
    @command="onCommand"
    @visible-change="onVisibleChange"
  >
    <component
      :is="as"
      :class="triggerClass"
      :type="as === 'button' ? 'button' : undefined"
      :title="title"
      :aria-label="title || t('common.more')"
      @click.stop
    >
      <MoreHorizontal :size="iconSize || 16" :color="iconColor || undefined" />
    </component>

    <template #dropdown>
      <el-dropdown-menu>
        <li v-if="boardLocked && lockReason" class="preview-lock-hint" role="note">
          {{ lockReason }}
        </li>
        <!-- Shown only in the dimension menu -->
        <template v-if="scene === 'dimension'">
          <el-dropdown-item
            command="create_above"
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("dashboard.createDimensionAbove") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="create_below"
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("dashboard.createDimensionBelow") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="rename"
            divided
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("common.rename") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="delete"
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("common.delete") }}
          </el-dropdown-item>
        </template>

        <!-- Default chart/metric menu (no create-dimension entry) -->
        <template v-else>
          <el-dropdown-item
            command="rename"
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("common.rename") }}
          </el-dropdown-item>
          <el-dropdown-item v-if="scene === 'metric'" command="parameters">
            {{ t("dashboard.editParameters") }}
          </el-dropdown-item>
          <el-dropdown-item v-if="scene === 'metric'" command="view-query">
            {{ t("dashboard.viewMetric") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="delete"
            divided
            :disabled="boardLocked"
            :title="boardLocked ? lockReason : undefined"
          >
            {{ t("common.delete") }}
          </el-dropdown-item>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { useAttrs } from "vue";
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import { MoreHorizontal } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });

defineProps({
  trigger: { type: String, default: "click" },
  hideOnClick: { type: Boolean, default: true },
  as: { type: String, default: "span" },
  triggerClass: { type: String, default: "" },
  title: { type: String, default: "" },
  iconColor: { type: String, default: "" },
  iconSize: { type: [Number, String], default: undefined },
  scene: { type: String, default: "" }, // 'dimension' | 'metric' | ''(default: chart)
  boardLocked: { type: Boolean, default: false },
  lockReason: { type: String, default: "" },
});

const emit = defineEmits(["command", "visible-change"]);
const attrs = useAttrs();

function onCommand(cmd) {
  emit("command", cmd);
}

function onVisibleChange(v) {
  emit("visible-change", v);
}
</script>

<style scoped>
.preview-lock-hint {
  max-width: 240px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  list-style: none;
}
</style>
