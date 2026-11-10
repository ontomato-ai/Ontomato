<script setup lang="ts">
import { computed, inject } from "vue";
import { availablePages, usePlatformHost } from "@ontomato/platform-admin";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { AppBuilder, type AppBuilderPlatform } from "@ontomato/workbench-ui/features/app-builder";
import { subscribeAppPageContext } from "../app-host";
import { openApplicationKey } from "../apps";
import { useApplicationCatalog } from "../catalog";

/**
 * 应用构建 in the platform: the builder, handed the facts only the platform holds. The app in its preview reports what its
 * reader looks at through this window's app host. A publication shows in the catalog the rail draws, which the builder
 * reads again after publishing or rolling back, and a published application opens through its rail row's entry. Where
 * the edition manages permissions (its navigation holds that page), the builder leads to it, or tells a reader who may
 * not open it to ask an administrator.
 */
const host = usePlatformHost();
const platform: AppBuilderPlatform = {
  subscribePageContext: subscribeAppPageContext,
  catalog: useApplicationCatalog(),
  openApplication: inject(openApplicationKey)!,
  permissions: computed(() => {
    const path = platformRoutes.permissions.path;
    const page = host.navigation.value.pages.find((item) => item.path === path);
    return page ? { path, open: availablePages(host.navigation.value, host.access).includes(page) } : null;
  }),
};
</script>

<template>
  <AppBuilder :platform="platform" />
</template>
