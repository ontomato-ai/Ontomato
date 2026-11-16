<script setup lang="ts">
import {inject} from 'vue';
import {ElDialog} from 'element-plus';
import type {ProductGraph} from '@ontomato/contracts/product-graph';
import {managerOverlayKey} from '../overlay';
import ProductAssetGraph from './ProductAssetGraph.vue';
defineProps<{graph:ProductGraph;title?:string}>();
const open=defineModel<boolean>({required:true});
const emit=defineEmits<{open:[id:string]}>();
const overlay=inject(managerOverlayKey,'body');
function select(id:string){open.value=false;emit('open',id);}
</script>
<template><ElDialog v-model="open" :title="title??'资产引用图'" fullscreen :append-to="overlay" destroy-on-close class="product-graph-dialog"><ProductAssetGraph class="expanded-product-graph" :graph="graph" expanded @open="select"/></ElDialog></template>
<style>
.ontology-manager .el-dialog.product-graph-dialog.is-fullscreen{width:100vw!important;max-width:none!important;height:100dvh!important;max-height:none!important;margin:0!important;border-radius:0}
.ontology-manager .product-graph-dialog .el-dialog__body{max-height:none;overflow:hidden}
.product-graph-dialog .expanded-product-graph{height:calc(100dvh - 110px);display:flex;flex-direction:column}
.product-graph-dialog .expanded-product-graph .graph-canvas{flex:1;min-height:0;max-height:none}
</style>
