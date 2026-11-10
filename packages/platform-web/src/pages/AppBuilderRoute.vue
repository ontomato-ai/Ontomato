<script setup lang="ts">
import { computed, inject } from "vue";
import { usePlatformHost } from "@ontomato/platform-admin";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { AppBuilder, type AppBuilderPlatform } from "@ontomato/workbench-ui/features/app-builder";
import { subscribeAppPageContext, registerBuildPreview } from "../app-host";
import { openApplicationKey } from "../apps";
import { useApplicationCatalog } from "../catalog";

/**
 * 应用构建 in the platform: the builder, handed the facts only the platform holds. The app in its preview reports what its
 * reader looks at through this window's app host. A publication shows in the catalog the rail draws, which the builder
 * reads again after publishing or rolling back, and a published application opens through its rail row's entry.
 *
 * Where the edition manages permissions (its navigation holds that page), the builder leads a reader to it exactly when
 * the rail does: when the catalog lists the application the page belongs to. Anyone else is told to ask an
 * administrator.
 */
const host = usePlatformHost();
const catalog = useApplicationCatalog();
const platform: AppBuilderPlatform = {
  subscribePageContext: subscribeAppPageContext,
  registerPreviewFrame: registerBuildPreview,
  catalog,
  openApplication: inject(openApplicationKey)!,
  permissions: computed(() => {
    const path = platformRoutes.permissions.path;
    if (!host.navigation.value.pages.some((page) => page.path === path)) return null;
    return { path, open: catalog.applications.value.some((app) => app.entry.path === path) };
  }),
};
</script>

<template>
  <AppBuilder :platform="platform" />
</template>
