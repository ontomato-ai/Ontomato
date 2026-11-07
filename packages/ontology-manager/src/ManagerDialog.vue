<script setup lang="ts">
import { inject } from "vue";
import { ElDialog } from "element-plus";
import { managerOverlayKey } from "./overlay";

defineOptions({ inheritAttrs: false });
const target = inject(managerOverlayKey);
</script>

<template>
  <el-dialog v-bind="$attrs" :append-to="target || 'body'" append-to-body align-center>
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </el-dialog>
</template>
