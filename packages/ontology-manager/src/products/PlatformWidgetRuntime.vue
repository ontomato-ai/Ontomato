<script setup lang="ts">
import {inject,type Component} from 'vue';
import {productPlatformRuntimeKey,type ProductAsset} from '@ontomato/contracts/product-assets';
defineProps<{asset:ProductAsset;preview?:boolean}>();
const runtime=inject<Component|null>(productPlatformRuntimeKey,null);
</script>
<template><component :is="runtime" v-if="runtime" :platform-widget-asset="asset" :preview="preview"/><p v-else>当前宿主未提供平台组件运行接口</p></template>
