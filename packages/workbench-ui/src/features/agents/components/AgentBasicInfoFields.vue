<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { avatarIconOptions, darkAvatarColorOptions, lightAvatarColorOptions } from "@ontomato/agent-shell-ui";
import { useTheme } from "../../../composables/useTheme";

const name = defineModel<string>("name", { required: true });
const description = defineModel<string>("description", { required: true });
/** The avatar's icon key. */
const avatarKey = defineModel<string>("avatarKey", { required: true });
/**
 * The avatar's swatch, as its light-palette value. The picker shows the current theme's palette; the two palettes
 * correspond by index, so switching theme changes nothing chosen.
 */
const avatarColor = defineModel<string>("avatarColor", { required: true });
const { t } = useI18n();
const { isDark } = useTheme();
const swatches = computed(() => (isDark.value ? darkAvatarColorOptions : lightAvatarColorOptions));
const chosenSwatch = computed(() => lightAvatarColorOptions.indexOf(avatarColor.value));
</script>

<template>
  <el-form-item :label="t('common.name')" required>
    <el-input v-model="name" :placeholder="t('admin.agentNameHint')" />
  </el-form-item>
  <el-form-item :label="t('common.description')">
    <el-input v-model="description" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" :placeholder="t('admin.agentDescHint')" />
  </el-form-item>
  <el-form-item :label="t('common.avatar')">
    <div class="avatar-choices">
      <button
        v-for="option in avatarIconOptions"
        :key="option.key"
        type="button"
        class="avatar-icon-option"
        :class="{ active: avatarKey === option.key }"
        :title="option.key"
        :aria-label="option.key"
        :aria-pressed="avatarKey === option.key"
        @click="avatarKey = option.key"
      >
        <component :is="option.icon" :size="18" aria-hidden="true" />
      </button>
    </div>
  </el-form-item>
  <el-form-item :label="t('common.color')">
    <div class="avatar-choices">
      <button
        v-for="(color, index) in swatches"
        :key="index"
        type="button"
        class="avatar-color-option"
        :class="{ active: chosenSwatch === index }"
        :style="{ background: color }"
        :aria-label="`${t('common.color')} ${index + 1}`"
        :aria-pressed="chosenSwatch === index"
        @click="avatarColor = lightAvatarColorOptions[index]!"
      />
    </div>
  </el-form-item>
</template>

<style scoped>
.avatar-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.avatar-icon-option,
.avatar-color-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  box-sizing: border-box;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), background-color var(--transition-fast), box-shadow var(--transition-fast);
}
.avatar-icon-option {
  border: 1.5px solid var(--el-border-color);
  background: var(--el-fill-color-extra-light);
  color: var(--el-color-primary);
}
.avatar-icon-option:hover,
.avatar-icon-option.active {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
  background: var(--el-color-primary-light-9);
}
.avatar-icon-option.active {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}
.avatar-color-option {
  border: 2px solid transparent;
}
.avatar-color-option:hover {
  border-color: var(--el-border-color-dark);
}
.avatar-color-option.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 15%, transparent);
}
button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
</style>
