<script setup lang="ts">
import {computed,ref} from 'vue';
import {ElButton} from 'element-plus/es/components/button/index';
import {ElInput} from 'element-plus/es/components/input/index';
import {domainApplicationIconKeys,recommendApplicationIcon} from '@ontomato/contracts/application-icons';
import {appIcon} from './icons';
const model=defineModel<string>({required:true});
/** `name` lets the picker recommend an icon for the application's name; without it there is nothing to recommend from. */
/** `heading` false leaves the label to a form that already names the field; the current icon is still shown. */
const props=withDefaults(defineProps<{name?:string;locale?:string;disabled?:boolean;heading?:boolean}>(),{heading:true});
const search=ref('');
const zh=computed(()=>props.locale?.startsWith('zh'));
const names:Record<string,string>={'app-window':'应用窗口',users:'人员团队',microscope:'科研实验',presentation:'交流演讲','graduation-cap':'教育学生',briefcase:'业务公文','shopping-cart':'采购订单',package:'库存物流','clipboard-list':'项目任务',chart:'统计分析',wallet:'财务预算','heart-pulse':'医疗健康',building:'机构建筑',globe:'全球网络',calendar:'日历',book:'书籍知识',folder:'文件夹',workflow:'工作流',database:'数据库',shield:'安全',home:'个人工作台',agents:'智能体',diagnosis:'诊断',knowledge:'知识',objects:'对象',ontology:'本体',schedule:'定时任务',dashboards:'仪表盘',permissions:'权限',settings:'设置',governance:'数据治理',builder:'应用构建',pages:'表格',gallery:'应用广场','agent-builder':'智能体构建'};
/*
 * A domain application picks from the icons the contract leaves to domain applications: the built-in applications' own
 * icons (ontology, objects, knowledge, settings, …) are theirs, so two rail rows never look alike. An application that
 * already carries one still shows it above; it is refused only when someone changes it.
 */
const options=computed(()=>domainApplicationIconKeys.filter(key=>(key+' '+names[key]).toLowerCase().includes(search.value.toLowerCase())));
</script>
<template>
 <section class="application-icon-picker">
  <!-- With a heading, the icon held stands beside it; without one (a form field, whose label is the form's), beside the search. -->
  <div v-if="heading" class="icon-heading"><span>{{zh?'应用图标':'Application icon'}}</span><el-button v-if="name!==undefined" text :disabled="disabled" @click="model=recommendApplicationIcon(name)">{{zh?'自动推荐':'Recommend'}}</el-button><component :is="appIcon(model)" :size="20"/></div>
  <div class="icon-search"><span v-if="!heading" class="icon-current"><component :is="appIcon(model)" :size="20"/></span><el-input v-model="search" :disabled="disabled" :placeholder="zh?'搜索系统图标（名称或英文关键词）':'Search system icons'" :aria-label="zh?'搜索系统图标':'Search system icons'" clearable/><el-button v-if="!heading&&name!==undefined" text :disabled="disabled" @click="model=recommendApplicationIcon(name)">{{zh?'自动推荐':'Recommend'}}</el-button></div>
  <div class="icon-options" role="group" :aria-label="zh?'系统图标库':'System icon library'"><button v-for="key in options" :key="key" type="button" :disabled="disabled" :title="zh?names[key]:key" :aria-label="zh?names[key]:key" :aria-pressed="model===key" @click="model=key"><component :is="appIcon(key)" :size="20"/></button></div>
 </section>
</template>
<style scoped>
.icon-heading{display:flex;align-items:center;gap:8px;margin-bottom:6px}.icon-heading>span{flex:1}.icon-search{display:flex;align-items:center;gap:8px}.icon-current{display:grid;place-items:center;flex:none;width:36px;height:36px;border:1px solid var(--el-color-primary);border-radius:var(--radius-sm);background:var(--el-color-primary-light-9);color:var(--el-color-primary)}.icon-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(36px,1fr));gap:6px;max-height:180px;overflow:auto;margin-top:10px}.icon-options button{display:grid;place-items:center;height:36px;border:1px solid var(--el-border-color-light);border-radius:var(--radius-sm);background:var(--el-bg-color);color:var(--el-text-color-secondary);cursor:pointer}.icon-options button[aria-pressed=true]{color:var(--el-color-primary);border-color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.icon-options button:disabled{cursor:default;opacity:.5}
</style>
