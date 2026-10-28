<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useTheme } from "@ontomato/workbench-ui/composables/useTheme";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import WorkbenchUserMenu from "./WorkbenchUserMenu.vue";

/** Open-source workbench: the shared business workbench with this edition's account menu. */
const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const showUserMenu = ref(false);
const defaultLogo = `${import.meta.env.BASE_URL}ontomato-mark-green.svg`;
</script>

<template>
  <BusinessWorkbench :default-logo="defaultLogo" default-brand-name="Ontomato">
    <template #footer>
      <WorkbenchUserMenu
        v-model:visible="showUserMenu"
        :is-dark="isDark"
        @admin="router.push('/admin')"
        @toggle-theme="toggleTheme"
      />
    </template>
  </BusinessWorkbench>
</template>
