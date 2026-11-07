<script setup lang="ts">
import { useI18n } from "vue-i18n";

const name = defineModel<string>("name", { required: true });
const description = defineModel<string>("description", { required: true });
const { t } = useI18n();
</script>

<template>
  <el-form-item :label="t('common.name')" required>
    <el-input v-model="name" :placeholder="t('admin.agentNameHint')" />
  </el-form-item>
  <el-form-item :label="t('common.description')">
    <el-input v-model="description" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" :placeholder="t('admin.agentDescHint')" />
  </el-form-item>
</template>
